// E2E: render the short fixture (2s / 24fps / 1280x720, spec §12.3) in the sandbox image and check
// the outputs independently of the in-container verification.
//   pnpm vitest run -c tests/container/vitest.config.ts
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, test } from 'vitest';
import { FONT_IDS, getDateAtFrame, getTotalFrames, parseRenderConfig, type RenderConfig } from '../../src/lib/renderer/index.ts';
import {
  alphaStats,
  checkAlphaFrame,
  checkMovProbe,
  checkMp4Black,
  checkMp4Probe,
  DEFAULT_TOOLS,
  extractFrame,
  isFaststart,
  probe,
  type Tools,
} from '../../container/verify-output.ts';
import { dockerAvailable, ensureImage, renderInDocker } from '../../scripts/render-local.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const FIXTURE = join(ROOT, 'tests/container/fixtures/short.json');
const OUT = join(ROOT, 'out/test-container');
const HAS_DOCKER = dockerAvailable();

/** Prefer host ffmpeg/ffprobe (an independent build); fall back to the image's. */
function toolsFor(image: string): Tools {
  const host = spawnSync('ffprobe', ['-version'], { stdio: 'ignore' });
  if (host.status === 0) return DEFAULT_TOOLS;
  const prefix = ['docker', 'run', '--rm', '--network', 'none', '-v', `${OUT}:${OUT}:ro`, image];
  return { ffmpeg: [...prefix, 'ffmpeg'], ffprobe: [...prefix, 'ffprobe'] };
}

/** Fraction of pixels whose alpha differs by more than 32 (text-shape difference). */
function alphaDiffFraction(a: Buffer, b: Buffer): number {
  expect(a.length).toBe(b.length);
  let diff = 0;
  for (let i = 3; i < a.length; i += 4) if (Math.abs(a[i] - b[i]) > 32) diff++;
  return diff / (a.length / 4);
}

/** Number of pixels with any coverage (alpha > 0). */
function inkPixels(rgba: Buffer): number {
  let n = 0;
  for (let i = 3; i < rgba.length; i += 4) if (rgba[i] > 0) n++;
  return n;
}

/** Max per-channel RGB difference over pixels opaque in both images. */
function opaqueRgbMaxDiff(a: Buffer, b: Buffer): number {
  let max = 0;
  for (let i = 0; i < a.length; i += 4) {
    if (a[i + 3] < 250 || b[i + 3] < 250) continue;
    for (let c = 0; c < 3; c++) max = Math.max(max, Math.abs(a[i + c] - b[i + c]));
  }
  return max;
}

describe.skipIf(!HAS_DOCKER)('container renderer (docker)', () => {
  let config: RenderConfig;
  let totalFrames: number;
  let image: string;
  let tools: Tools;
  let result: Record<string, any>;
  const shortOut = join(OUT, 'short');
  const mp4 = join(shortOut, 'preview.mp4');
  const mov = join(shortOut, 'transparent.mov');
  const golden = { first: join(OUT, 'golden-first'), last: join(OUT, 'golden-last') };

  beforeAll(async () => {
    config = parseRenderConfig(JSON.parse(await readFile(FIXTURE, 'utf8')));
    totalFrames = getTotalFrames(config);
    await rm(OUT, { recursive: true, force: true });
    await mkdir(OUT, { recursive: true });

    image = await ensureImage({ quiet: true });
    tools = toolsFor(image);
    expect(await renderInDocker({ configPath: FIXTURE, outDir: shortOut, image })).toBe(0);
    result = JSON.parse(await readFile(join(shortOut, 'result.json'), 'utf8'));

    // Golden stills: a config pinned to the expected date (start == end) renders exactly that
    // date at frame 0 via the same container Chromium page, independent of easing/timing.
    for (const [key, date] of [['first', config.startDate], ['last', config.endDate]] as const) {
      const cfgPath = join(OUT, `golden-${key}.json`);
      await writeFile(cfgPath, JSON.stringify({ ...config, startDate: date, endDate: date }));
      expect(await renderInDocker({ configPath: cfgPath, outDir: golden[key], image, entryArgs: ['--stills', '0'] })).toBe(0);
    }
  });

  test('in-container result.json reports success with all checks passing', () => {
    expect(result.ok).toBe(true);
    expect(result.totalFrames).toBe(48);
    const failed = (result.verification.checks as { ok: boolean }[]).filter((c) => !c.ok);
    expect(failed).toEqual([]);
    expect(result.mp4.bytes).toBeGreaterThan(0);
    expect(result.mov.bytes).toBeGreaterThan(result.mp4.bytes);
  });

  test('progress.json ends at done/100 and PNG frames are not left in the output', async () => {
    const progress = JSON.parse(await readFile(join(shortOut, 'progress.json'), 'utf8'));
    expect(progress).toMatchObject({ stage: 'done', progress: 100 });
    const listing = spawnSync('ls', [shortOut], { encoding: 'utf8' }).stdout.split('\n').filter(Boolean).sort();
    expect(listing).toEqual(['preview.mp4', 'progress.json', 'result.json', 'transparent.mov']);
  });

  test('ffprobe: MP4 is H.264 yuv420p 1280x720 24fps, 48 frames, 2.0s, faststart', async () => {
    const info = await probe(mp4, tools);
    expect(info).toMatchObject({ codec: 'h264', pixFmt: 'yuv420p', width: 1280, height: 720, fps: 24, frames: 48 });
    expect(info.durationSeconds).toBeCloseTo(2.0, 1);
    expect(Math.abs(info.durationSeconds - 2)).toBeLessThanOrEqual(1 / 24);
    expect(checkMp4Probe(info, { width: 1280, height: 720, fps: 24, totalFrames }).filter((c) => !c.ok)).toEqual([]);
    expect(await isFaststart(mp4)).toBe(true);
  });

  test('ffprobe: MOV is ProRes 4444 with an alpha pixel format, 48 frames, 2.0s', async () => {
    const info = await probe(mov, tools);
    expect(info).toMatchObject({ codec: 'prores', width: 1280, height: 720, fps: 24, frames: 48 });
    expect(info.profile).toMatch(/^4444/);
    expect(info.pixFmt).toMatch(/^yuva444p/);
    expect(Math.abs(info.durationSeconds - 2)).toBeLessThanOrEqual(1 / 24);
    expect(checkMovProbe(info, { width: 1280, height: 720, fps: 24, totalFrames }).filter((c) => !c.ok)).toEqual([]);
  });

  test('MOV keeps alpha: transparent background (alpha=0) and opaque white text (alpha>0)', async () => {
    for (const frame of [0, Math.floor(totalFrames / 2), totalFrames - 1]) {
      const rgba = await extractFrame(mov, frame, config.width, config.height, 'rgba', tools);
      const stats = alphaStats(rgba, config);
      expect(stats.cornersChecked).toBe(4);
      expect(stats.cornerMaxAlpha).toBe(0);
      expect(stats.textPixels).toBeGreaterThan(1000);
      expect(stats.textMaxAlpha).toBe(255);
      expect(checkAlphaFrame(stats, config).filter((c) => !c.ok)).toEqual([]);
    }
  });

  test('MP4 background is black', async () => {
    const rgb = await extractFrame(mp4, Math.floor(totalFrames / 2), config.width, config.height, 'rgb24', tools);
    expect(checkMp4Black(rgb, config).ok).toBe(true);
  });

  test('invalid config fails with a sanitized error code and exit 2', async () => {
    const cfgPath = join(OUT, 'invalid.json');
    const outDir = join(OUT, 'invalid');
    await writeFile(cfgPath, JSON.stringify({ ...config, width: 999, extra: '$(rm -rf /)' }));
    expect(await renderInDocker({ configPath: cfgPath, outDir, image })).toBe(2);
    const failed = JSON.parse(await readFile(join(outDir, 'result.json'), 'utf8'));
    expect(failed).toEqual({ ok: false, errorCode: 'INVALID_CONFIG', message: 'Render configuration is invalid.' });
  });

  test('first/last frames show the start/end dates (golden comparison)', async () => {
    expect(getDateAtFrame(0, config)).toBe('2026.03.06');
    expect(getDateAtFrame(totalFrames - 1, config)).toBe('2020.01.01');

    const { width, height } = config;
    const movFirst = await extractFrame(mov, 0, width, height, 'rgba', tools);
    const movLast = await extractFrame(mov, totalFrames - 1, width, height, 'rgba', tools);
    const goldFirst = await extractFrame(join(golden.first, 'stills/frame_00000.png'), 0, width, height, 'rgba', tools);
    const goldLast = await extractFrame(join(golden.last, 'stills/frame_00000.png'), 0, width, height, 'rgba', tools);

    // Same date: text shapes match within ProRes round-trip noise.
    expect(alphaDiffFraction(movFirst, goldFirst)).toBeLessThan(0.0002);
    expect(alphaDiffFraction(movLast, goldLast)).toBeLessThan(0.0002);
    expect(opaqueRgbMaxDiff(movFirst, goldFirst)).toBeLessThanOrEqual(4);
    // Different dates are clearly distinguishable by the same metric.
    expect(alphaDiffFraction(goldFirst, goldLast)).toBeGreaterThan(0.002);
    expect(alphaDiffFraction(movFirst, goldLast)).toBeGreaterThan(0.002);
    expect(alphaDiffFraction(movLast, goldFirst)).toBeGreaterThan(0.002);
  });

  describe('date format 年月日 and font library', () => {
    const KANJI = 'YYYY年MM月DD日' as const;
    const kanjiOut = join(OUT, 'kanji');
    const stills: Record<string, Buffer> = {};
    let kanjiConfig: RenderConfig;
    let kanjiResult: Record<string, any>;

    beforeAll(async () => {
      // Short full render (1s) with the kanji format through the whole pipeline (in-container verify).
      kanjiConfig = parseRenderConfig({ ...config, dateFormat: KANJI, durationSeconds: 1 });
      const cfgPath = join(OUT, 'kanji.json');
      await writeFile(cfgPath, JSON.stringify(kanjiConfig));
      expect(await renderInDocker({ configPath: cfgPath, outDir: kanjiOut, image })).toBe(0);
      kanjiResult = JSON.parse(await readFile(join(kanjiOut, 'result.json'), 'utf8'));

      // One still per font: the start date in the kanji format (start == end -> frame 0 is that date).
      for (const fontFamily of FONT_IDS) {
        const still = { ...config, fontFamily, dateFormat: KANJI, endDate: config.startDate };
        const p = join(OUT, `font-${fontFamily}.json`);
        const dir = join(OUT, `font-${fontFamily}`);
        await writeFile(p, JSON.stringify(still));
        expect(await renderInDocker({ configPath: p, outDir: dir, image, entryArgs: ['--stills', '0'] }), fontFamily).toBe(0);
        stills[fontFamily] = await extractFrame(join(dir, 'stills/frame_00000.png'), 0, config.width, config.height, 'rgba', tools);
      }
    });

    test('kanji render succeeds with all in-container checks passing', () => {
      expect(getDateAtFrame(0, kanjiConfig)).toBe('2026年03月06日');
      expect(kanjiResult.ok).toBe(true);
      expect(kanjiResult.totalFrames).toBe(24);
      expect((kanjiResult.verification.checks as { ok: boolean }[]).filter((c) => !c.ok)).toEqual([]);
    });

    test('kanji MOV first frame matches the golden still and differs from the dot format', async () => {
      const { width, height } = config;
      const movFirst = await extractFrame(join(kanjiOut, 'transparent.mov'), 0, width, height, 'rgba', tools);
      const goldKanji = stills['bundled-mono']!;
      const goldDot = await extractFrame(join(golden.first, 'stills/frame_00000.png'), 0, width, height, 'rgba', tools);
      expect(alphaDiffFraction(movFirst, goldKanji)).toBeLessThan(0.0002);
      expect(opaqueRgbMaxDiff(movFirst, goldKanji)).toBeLessThanOrEqual(4);
      // Same date, same font, different format: 年月日 glyphs (wider than '.') change the image a lot.
      expect(alphaDiffFraction(goldKanji, goldDot)).toBeGreaterThan(0.002);
      // and the kanji string is wider, so it covers more pixels than the dotted one
      expect(inkPixels(goldKanji)).toBeGreaterThan(inkPixels(goldDot) * 1.2);
    });

    test('every font renders non-empty glyphs, and all fonts differ pairwise', () => {
      for (const id of FONT_IDS) expect(inkPixels(stills[id]!), id).toBeGreaterThan(3000);
      for (let i = 0; i < FONT_IDS.length; i++) {
        for (let j = i + 1; j < FONT_IDS.length; j++) {
          const [a, b] = [FONT_IDS[i]!, FONT_IDS[j]!];
          expect(alphaDiffFraction(stills[a]!, stills[b]!), `${a} vs ${b}`).toBeGreaterThan(0.002);
        }
      }
    });
  });
});
