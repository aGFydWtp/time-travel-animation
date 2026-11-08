// MP4 backdrop: the ffmpeg lavfi source color and the decoded-corner check follow backdropFor(color).
import { describe, expect, test } from 'vitest';
import { mp4Args } from '../../../container/render-entry.ts';
import { checkMp4Backdrop } from '../../../container/verify-output.ts';
import { parseRenderConfig, type RenderConfig } from '../../../src/lib/renderer/index.ts';

const BASE = {
  startDate: '2026-03-06',
  endDate: '2020-01-01',
  durationSeconds: 2,
  fps: 24,
  width: 1280,
  height: 720,
  easing: 'smootherstep',
  fontFamily: 'bundled-mono',
  fontSize: 96,
  color: '#FFFFFF',
  x: 0.5,
  y: 0.5,
};

function config(color: string): RenderConfig {
  return parseRenderConfig({ ...BASE, color });
}

function lavfiSource(args: string[]): string {
  const i = args.indexOf('lavfi');
  expect(i).toBeGreaterThanOrEqual(0);
  expect(args[i + 1]).toBe('-i');
  return args[i + 2]!;
}

/** Solid RGB24 frame of the config's size. */
function solid(cfg: RenderConfig, value: number): Buffer {
  return Buffer.alloc(cfg.width * cfg.height * 3, value);
}

describe('mp4Args backdrop', () => {
  test('light text composites over black', () => {
    const args = mp4Args('/work/frames', config('#FFFFFF'), 48, '/out/preview.mp4');
    expect(lavfiSource(args)).toBe('color=c=0x000000:s=1280x720:r=24');
  });

  test('dark text composites over white', () => {
    const args = mp4Args('/work/frames', config('#000000'), 48, '/out/preview.mp4');
    expect(lavfiSource(args)).toBe('color=c=0xFFFFFF:s=1280x720:r=24');
  });

  test('mid colors follow the contrast rule', () => {
    expect(lavfiSource(mp4Args('/f', config('#FF0000'), 48, '/o.mp4'))).toMatch(/^color=c=0x000000:/);
    expect(lavfiSource(mp4Args('/f', config('#1A237E'), 48, '/o.mp4'))).toMatch(/^color=c=0xFFFFFF:/);
  });

  test('the overlay filter graph is unchanged', () => {
    const args = mp4Args('/f', config('#000000'), 48, '/o.mp4');
    expect(args[args.indexOf('-filter_complex') + 1]).toBe(
      '[0:v][1:v]overlay=shortest=1:format=rgb,scale=out_color_matrix=bt709:out_range=tv,format=yuv420p[v]',
    );
  });
});

describe('checkMp4Backdrop', () => {
  test('light text: black corners pass (limited-range rounding allowed), white corners fail', () => {
    const cfg = config('#FFFFFF');
    expect(checkMp4Backdrop(solid(cfg, 0), cfg)).toMatchObject({ name: 'mp4.background', ok: true });
    expect(checkMp4Backdrop(solid(cfg, 6), cfg).ok).toBe(true);
    expect(checkMp4Backdrop(solid(cfg, 7), cfg).ok).toBe(false);
    expect(checkMp4Backdrop(solid(cfg, 255), cfg).ok).toBe(false);
  });

  test('dark text: white corners pass (limited-range rounding allowed), black corners fail', () => {
    const cfg = config('#000000');
    const white = checkMp4Backdrop(solid(cfg, 255), cfg);
    expect(white).toMatchObject({ name: 'mp4.background', ok: true });
    expect(white.detail).toContain('#FFFFFF');
    expect(checkMp4Backdrop(solid(cfg, 249), cfg).ok).toBe(true);
    expect(checkMp4Backdrop(solid(cfg, 248), cfg).ok).toBe(false);
    expect(checkMp4Backdrop(solid(cfg, 0), cfg).ok).toBe(false);
  });
});
