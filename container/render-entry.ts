// Container entry: config JSON -> transparent PNG frames (headless Chromium + shared renderer)
// -> preview.mp4 (H.264 over a black or white backdrop) + transparent.mov (ProRes 4444) -> verify -> result.json.
//
//   node /app/render-entry.mjs --config <config.json> --out <dir> [--work <dir>] [--stills 0,47]
//
// --stills renders only the listed frame indices to <out>/stills/frame_%05d.png (no encoding);
// used for golden-image comparisons.
import { realpathSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type Page } from 'playwright-core';
import { backdropFor, getTotalFrames, parseRenderConfig, type RenderConfig } from '../src/lib/renderer/index.ts';
import { run } from './proc.ts';
import { alphaStats, checkAlphaFrame, extractFrame, verifyOutputs, type VerifyReport } from './verify-output.ts';

const APP_DIR = dirname(fileURLToPath(import.meta.url));
const PAGE_ORIGIN = 'http://dcs-render.invalid';
const PAGE_URL = `${PAGE_ORIGIN}/render-page.html`;
const CHROMIUM_PATH = process.env.DCS_CHROMIUM_PATH ?? '/usr/bin/chromium';
const FRAME_PATTERN = 'frame_%05d.png';

type ErrorCode =
  | 'INVALID_ARGS'
  | 'INVALID_CONFIG'
  | 'BROWSER_LAUNCH_FAILED'
  | 'PAGE_INIT_FAILED'
  | 'FRAME_RENDER_FAILED'
  | 'ENCODE_MP4_FAILED'
  | 'ENCODE_MOV_FAILED'
  | 'VERIFY_FAILED'
  | 'IO_ERROR';

const ERROR_MESSAGES: Record<ErrorCode, string> = {
  INVALID_ARGS: 'Invalid command-line arguments.',
  INVALID_CONFIG: 'Render configuration is invalid.',
  BROWSER_LAUNCH_FAILED: 'Headless browser could not be started.',
  PAGE_INIT_FAILED: 'Render page or bundled font failed to load.',
  FRAME_RENDER_FAILED: 'Frame rendering failed.',
  ENCODE_MP4_FAILED: 'MP4 encoding failed.',
  ENCODE_MOV_FAILED: 'MOV encoding failed.',
  VERIFY_FAILED: 'Output verification failed.',
  IO_ERROR: 'File system error.',
};

class RenderError extends Error {
  readonly code: ErrorCode;
  constructor(code: ErrorCode, cause?: unknown) {
    super(ERROR_MESSAGES[code], { cause });
    this.code = code;
  }
}

async function stage<T>(code: ErrorCode, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof RenderError) throw err;
    throw new RenderError(code, err);
  }
}

interface Args {
  config: string;
  out: string;
  work: string | null;
  stills: number[] | null;
}

function parseArgs(argv: string[]): Args {
  const values = new Map<string, string>();
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i];
    const value = argv[i + 1];
    if (!key?.startsWith('--') || value === undefined) throw new RenderError('INVALID_ARGS');
    values.set(key.slice(2), value);
  }
  const config = values.get('config');
  const out = values.get('out');
  if (!config || !out) throw new RenderError('INVALID_ARGS');
  const stillsRaw = values.get('stills');
  const stills = stillsRaw ? stillsRaw.split(',').map((s) => Number(s)) : null;
  if (stills && !stills.every((n) => Number.isInteger(n) && n >= 0)) throw new RenderError('INVALID_ARGS');
  return { config: resolve(config), out: resolve(out), work: values.get('work') ?? null, stills };
}

// ---------------------------------------------------------------- progress

let outDir = '';
let lastProgressWrite = 0;

async function writeJsonAtomic(path: string, data: unknown): Promise<void> {
  const tmp = `${path}.tmp`;
  await writeFile(tmp, `${JSON.stringify(data, null, 2)}\n`);
  await rename(tmp, path);
}

let progressChain: Promise<void> = Promise.resolve();

let lastStage = 'starting';
let lastPct = 0;

/** Throttled (500 ms unless forced) and serialized progress.json writes. */
function progress(stageName: string, pct: number, force = false): Promise<void> {
  lastStage = stageName;
  lastPct = pct;
  const now = Date.now();
  if (!force && now - lastProgressWrite < 500) return progressChain;
  lastProgressWrite = now;
  const data = {
    stage: stageName,
    progress: Math.max(0, Math.min(100, Math.round(pct))),
    updatedAt: new Date(now).toISOString(),
  };
  progressChain = progressChain
    .catch(() => undefined)
    .then(() => writeJsonAtomic(join(outDir, 'progress.json'), data));
  return progressChain;
}

/**
 * Heartbeat: progress.json's updatedAt is refreshed at least every HEARTBEAT_MS even when the stage
 * reports nothing (browser start, long ffmpeg passes, verify). The Worker polls it to tell a live
 * render from a dead container.
 */
const HEARTBEAT_MS = 5_000;
let heartbeat: ReturnType<typeof setInterval> | undefined;

function startHeartbeat(): void {
  heartbeat = setInterval(() => {
    if (Date.now() - lastProgressWrite >= HEARTBEAT_MS) void progress(lastStage, lastPct, true).catch(() => undefined);
  }, HEARTBEAT_MS);
  heartbeat.unref();
}

function stopHeartbeat(): void {
  if (heartbeat) clearInterval(heartbeat);
  heartbeat = undefined;
}

// ---------------------------------------------------------------- browser

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.woff2': 'font/woff2',
};

async function openRenderPage(browser: Browser): Promise<Page> {
  const page = await browser.newPage({ viewport: { width: 320, height: 240 }, deviceScaleFactor: 1 });
  page.on('pageerror', (err) => console.error(`[page error] ${err.message}`));
  page.on('console', (msg) => {
    if (msg.type() === 'error' || msg.type() === 'warning') console.error(`[page ${msg.type()}] ${msg.text()}`);
  });
  // Serve the bundled page/script/font from /app via request interception under a fake origin:
  // no file:// CORS issues for FontFace, no listening server, and every other request is blocked
  // (the sandbox has no internet anyway).
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    const name = url.pathname.replace(/^\/+/, '');
    const type = CONTENT_TYPES[extname(name)];
    if (url.origin !== PAGE_ORIGIN || !type || name.includes('/') || name.includes('..')) {
      await route.abort('blockedbyclient');
      return;
    }
    try {
      const body = await readFile(join(APP_DIR, name));
      await route.fulfill({ status: 200, contentType: type, body });
    } catch {
      await route.fulfill({ status: 404, body: '' });
    }
  });
  await page.goto(PAGE_URL, { waitUntil: 'load' });
  await page.waitForFunction(() => typeof window.__dcs?.init === 'function');
  return page;
}

const DATA_URL_PREFIX = 'data:image/png;base64,';

async function renderPng(page: Page, frameIndex: number): Promise<Buffer> {
  const dataUrl = await page.evaluate((i) => window.__dcs.renderFrameToPng(i), frameIndex);
  if (!dataUrl.startsWith(DATA_URL_PREFIX)) throw new Error('Unexpected canvas data URL');
  return Buffer.from(dataUrl.slice(DATA_URL_PREFIX.length), 'base64');
}

function frameFile(dir: string, frameIndex: number): string {
  return join(dir, `frame_${String(frameIndex).padStart(5, '0')}.png`);
}

/** Render `indices` one at a time; at most one PNG write in flight (never all frames in memory). */
async function renderFrames(
  page: Page,
  indices: number[],
  dir: string,
  onFrame: (done: number) => Promise<void>,
): Promise<void> {
  let pendingWrite: Promise<void> = Promise.resolve();
  for (let n = 0; n < indices.length; n++) {
    const index = indices[n];
    const png = await renderPng(page, index);
    await pendingWrite;
    pendingWrite = writeFile(frameFile(dir, index), png);
    await onFrame(n + 1);
  }
  await pendingWrite;
}

// ---------------------------------------------------------------- ffmpeg

const COLOR_TAGS = ['-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709', '-color_range', 'tv'];

export function mp4Args(framesDir: string, config: RenderConfig, totalFrames: number, outFile: string): string[] {
  const { width, height, fps } = config;
  // Black or white, whichever contrasts with the text (same rule as the preview's CSS background).
  const backdrop = backdropFor(config.color).replace('#', '0x');
  return [
    '-hide_banner', '-nostdin', '-y', '-loglevel', 'error',
    '-f', 'lavfi', '-i', `color=c=${backdrop}:s=${width}x${height}:r=${fps}`,
    '-framerate', String(fps), '-start_number', '0', '-i', join(framesDir, FRAME_PATTERN),
    // Straight-alpha PNG over the opaque backdrop, blended in RGB, then BT.709 limited-range 4:2:0.
    '-filter_complex',
    '[0:v][1:v]overlay=shortest=1:format=rgb,scale=out_color_matrix=bt709:out_range=tv,format=yuv420p[v]',
    '-map', '[v]',
    '-frames:v', String(totalFrames),
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-profile:v', 'high', '-pix_fmt', 'yuv420p',
    '-r', String(fps),
    ...COLOR_TAGS,
    '-movflags', '+faststart',
    '-an',
    '-progress', 'pipe:1', '-nostats',
    outFile,
  ];
}

export function movArgs(framesDir: string, config: RenderConfig, totalFrames: number, outFile: string): string[] {
  const { fps } = config;
  return [
    '-hide_banner', '-nostdin', '-y', '-loglevel', 'error',
    '-framerate', String(fps), '-start_number', '0', '-i', join(framesDir, FRAME_PATTERN),
    '-vf', 'scale=out_color_matrix=bt709:out_range=tv,format=yuva444p10le',
    '-frames:v', String(totalFrames),
    '-c:v', 'prores_ks', '-profile:v', '4', '-pix_fmt', 'yuva444p10le', '-alpha_bits', '16',
    '-vendor', 'apl0',
    '-r', String(fps),
    ...COLOR_TAGS,
    '-an',
    '-progress', 'pipe:1', '-nostats',
    outFile,
  ];
}

async function ffmpeg(args: string[], totalFrames: number, onProgress: (fraction: number) => void): Promise<void> {
  await run(['ffmpeg', ...args], {
    onStdoutLine(line) {
      const m = /^frame=(\d+)$/.exec(line);
      if (m) onProgress(Math.min(1, Number(m[1]) / totalFrames));
    },
  });
}

// ---------------------------------------------------------------- main

interface Timings {
  [stage: string]: number;
}

async function main(): Promise<void> {
  const startedAt = Date.now();
  const args = parseArgs(process.argv.slice(2));
  outDir = args.out;
  await stage('IO_ERROR', () => mkdir(outDir, { recursive: true }));
  await progress('starting', 0, true);
  startHeartbeat();

  const config = await stage('INVALID_CONFIG', async () =>
    parseRenderConfig(JSON.parse(await readFile(args.config, 'utf8'))),
  );
  const totalFrames = getTotalFrames(config);
  const stills = args.stills;
  if (stills && !stills.every((i) => i < totalFrames)) throw new RenderError('INVALID_ARGS');

  const ownWork = args.work === null;
  const work = await stage('IO_ERROR', async () =>
    args.work ? (await mkdir(args.work, { recursive: true }), resolve(args.work)) : mkdtemp(join(tmpdir(), 'dcs-')),
  );
  const framesDir = stills ? join(outDir, 'stills') : join(work, 'frames');
  const timings: Timings = {};
  let browser: Browser | null = null;

  try {
    await stage('IO_ERROR', () => mkdir(framesDir, { recursive: true }));

    // 1. Frames
    let t = Date.now();
    browser = await stage('BROWSER_LAUNCH_FAILED', () =>
      chromium.launch({
        executablePath: CHROMIUM_PATH,
        headless: true,
        args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--mute-audio'],
      }),
    );
    const activeBrowser = browser;
    const page = await stage('PAGE_INIT_FAILED', async () => {
      const p = await openRenderPage(activeBrowser);
      const info = await p.evaluate((c) => window.__dcs.init(c), config);
      if (info.totalFrames !== totalFrames || info.width !== config.width || info.height !== config.height) {
        throw new Error(`Page init mismatch: ${JSON.stringify(info)}`);
      }
      return p;
    });
    timings.browserStartMs = Date.now() - t;

    t = Date.now();
    const indices = stills ?? Array.from({ length: totalFrames }, (_, i) => i);
    const renderShare = stills ? 95 : 60;
    await stage('FRAME_RENDER_FAILED', () =>
      renderFrames(page, indices, framesDir, (done) => progress('rendering', (done / indices.length) * renderShare)),
    );
    timings.framesMs = Date.now() - t;
    await browser.close();
    browser = null;

    if (stills) {
      await writeJsonAtomic(join(outDir, 'result.json'), {
        ok: true,
        mode: 'stills',
        totalFrames,
        stills: indices.map((i) => `stills/${basename(frameFile(framesDir, i))}`),
        timings,
      });
      await progress('done', 100, true);
      return;
    }

    // Alpha proof on the intermediate: decode frame 0 PNG and require a transparent background
    // and opaque text before spending time on encoding.
    const pngAlpha = await stage('FRAME_RENDER_FAILED', async () => {
      const rgba = await extractFrame(frameFile(framesDir, 0), 0, config.width, config.height, 'rgba');
      const stats = alphaStats(rgba, config);
      const failed = checkAlphaFrame(stats, config).filter((c) => !c.ok);
      if (failed.length) throw new Error(`frame 0 PNG alpha check failed: ${JSON.stringify(failed)}`);
      return stats;
    });

    // 2. Encode
    const mp4 = join(outDir, 'preview.mp4');
    const mov = join(outDir, 'transparent.mov');
    t = Date.now();
    await stage('ENCODE_MP4_FAILED', () =>
      ffmpeg(mp4Args(framesDir, config, totalFrames, mp4), totalFrames, (f) => void progress('encoding_mp4', 60 + f * 15)),
    );
    timings.mp4Ms = Date.now() - t;
    t = Date.now();
    await stage('ENCODE_MOV_FAILED', () =>
      ffmpeg(movArgs(framesDir, config, totalFrames, mov), totalFrames, (f) => void progress('encoding_mov', 75 + f * 20)),
    );
    timings.movMs = Date.now() - t;

    // 3. Verify
    await progress('verifying', 96, true);
    t = Date.now();
    const report: VerifyReport = await stage('VERIFY_FAILED', () => verifyOutputs({ mp4, mov }, config, totalFrames));
    timings.verifyMs = Date.now() - t;
    const [mp4Stat, movStat] = await stage('IO_ERROR', () => Promise.all([stat(mp4), stat(mov)]));
    timings.totalMs = Date.now() - startedAt;

    const result = {
      ok: report.ok,
      ...(report.ok ? {} : { errorCode: 'VERIFY_FAILED', message: ERROR_MESSAGES.VERIFY_FAILED }),
      totalFrames,
      config,
      mp4: { file: 'preview.mp4', contentType: 'video/mp4', ...report.mp4, bytes: mp4Stat.size },
      mov: { file: 'transparent.mov', contentType: 'video/quicktime', ...report.mov, bytes: movStat.size },
      verification: { pngFrame0Alpha: pngAlpha, sampleFrame: report.sampleFrame, alpha: report.alpha, checks: report.checks },
      timings,
    };
    await writeJsonAtomic(join(outDir, 'result.json'), result);
    if (!report.ok) {
      for (const c of report.checks.filter((x) => !x.ok)) console.error(`[verify] FAIL ${c.name}: ${c.detail}`);
      await progress('failed', 100, true);
      process.exitCode = 1;
      return;
    }
    await progress('done', 100, true);
  } finally {
    stopHeartbeat();
    if (browser) await browser.close().catch(() => undefined);
    // PNG intermediates never outlive the job (stills are the requested output and stay).
    const scratch = ownWork ? work : stills ? null : framesDir;
    if (scratch) await rm(scratch, { recursive: true, force: true }).catch(() => undefined);
  }
}

// Run only as the entry script, so tests can import the ffmpeg argument builders.
// Compare real paths: Node resolves the main module through symlinks, argv[1] may not.
const isEntry = (() => {
  if (process.argv[1] === undefined) return false;
  try {
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]);
  } catch {
    return false;
  }
})();

if (isEntry) main().catch(async (err: unknown) => {
  const code: ErrorCode = err instanceof RenderError ? err.code : 'IO_ERROR';
  // Full detail goes to stderr (container logs); result.json only carries a sanitized code + message.
  console.error(`[render-entry] ${code}:`, err instanceof Error && err.cause ? err.cause : err);
  if (outDir) {
    await writeJsonAtomic(join(outDir, 'result.json'), { ok: false, errorCode: code, message: ERROR_MESSAGES[code] }).catch(
      () => undefined,
    );
    await progress('failed', 100, true).catch(() => undefined);
  }
  process.exitCode = code === 'INVALID_ARGS' || code === 'INVALID_CONFIG' ? 2 : 1;
});
