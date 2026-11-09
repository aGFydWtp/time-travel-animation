// Backgrounds: the ffmpeg lavfi source colour and the decoded-corner checks follow the chosen background,
// or backdropFor(color) for a transparent render.
import { describe, expect, test } from 'vitest';
import { movArgs, mp4Args } from '../../../container/render-entry.ts';
import {
  checkMovBackground,
  checkMovProbe,
  checkMp4Backdrop,
  type ProbeInfo,
} from '../../../container/verify-output.ts';
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

function config(color: string, background?: string): RenderConfig {
  return parseRenderConfig({ ...BASE, color, ...(background ? { background } : {}) });
}

/** Solid RGB24 frame of one colour. */
function solidRgb(cfg: RenderConfig, rgb: [number, number, number]): Buffer {
  const buf = Buffer.alloc(cfg.width * cfg.height * 3);
  for (let i = 0; i < buf.length; i += 3) buf.set(rgb, i);
  return buf;
}

const valueAfter = (args: string[], flag: string) => args[args.indexOf(flag) + 1];

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

describe('solid background', () => {
  test('the MP4 composites over the chosen colour regardless of the text colour', () => {
    expect(lavfiSource(mp4Args('/f', config('#FFFFFF', '#00ff00'), 48, '/o.mp4'))).toBe('color=c=0x00FF00:s=1280x720:r=24');
    expect(lavfiSource(mp4Args('/f', config('#000000', '#000000'), 48, '/o.mp4'))).toMatch(/^color=c=0x000000:/);
  });

  test('transparent MOV: alpha ProRes 4444 straight from the frames (no colour source)', () => {
    const args = movArgs('/f', config('#FFFFFF'), 48, '/o.mov');
    expect(args).not.toContain('lavfi');
    expect(valueAfter(args, '-pix_fmt')).toBe('yuva444p10le');
    expect(valueAfter(args, '-alpha_bits')).toBe('16');
    expect(valueAfter(args, '-vf')).toBe('scale=out_color_matrix=bt709:out_range=tv,format=yuva444p10le');
  });

  test('solid MOV: opaque ProRes 4444 (profile 4, 10-bit 4:4:4, no alpha) composited over the colour', () => {
    const args = movArgs('/f', config('#FFFFFF', '#00FF00'), 48, '/o.mov');
    expect(lavfiSource(args)).toBe('color=c=0x00FF00:s=1280x720:r=24');
    expect(valueAfter(args, '-c:v')).toBe('prores_ks');
    expect(valueAfter(args, '-profile:v')).toBe('4');
    expect(valueAfter(args, '-pix_fmt')).toBe('yuv444p10le');
    expect(args).not.toContain('-alpha_bits');
    expect(valueAfter(args, '-filter_complex')).toBe(
      '[0:v][1:v]overlay=shortest=1:format=rgb,scale=out_color_matrix=bt709:out_range=tv,format=yuv444p10le[v]',
    );
    expect(valueAfter(args, '-color_range')).toBe('tv');
  });

  test('background checks accept the measured round trip (#00FF00 -> 0,255,1) within ±6 per channel', () => {
    const green = config('#FFFFFF', '#00FF00');
    for (const check of [checkMp4Backdrop, checkMovBackground]) {
      expect(check(solidRgb(green, [0, 255, 1]), green).ok).toBe(true);
      expect(check(solidRgb(green, [6, 249, 6]), green).ok).toBe(true);
      expect(check(solidRgb(green, [7, 255, 0]), green).ok).toBe(false);
      expect(check(solidRgb(green, [0, 0, 0]), green).ok).toBe(false);
    }
    expect(checkMovBackground(solidRgb(green, [0, 255, 1]), green)).toMatchObject({
      name: 'mov.background',
      detail: expect.stringContaining('#00FF00'),
    });
    // a custom colour
    const custom = config('#000000', '#12ABEF');
    expect(checkMp4Backdrop(solidRgb(custom, [0x12, 0xab, 0xef]), custom).ok).toBe(true);
    expect(checkMp4Backdrop(solidRgb(custom, [0x12, 0xab, 0xff]), custom).ok).toBe(false);
  });

  test('opaque MOV probe requires a 4:4:4 pixel format without alpha', () => {
    const info: ProbeInfo = {
      codec: 'prores', profile: '4444', pixFmt: 'yuv444p12le', width: 1280, height: 720, fps: 24, frames: 48,
      durationSeconds: 2, formatName: 'mov,mp4', bytes: 1,
    };
    const exp = { width: 1280, height: 720, fps: 24, totalFrames: 48 };
    expect(checkMovProbe(info, exp, true).filter((c) => !c.ok)).toEqual([]);
    expect(checkMovProbe(info, exp).find((c) => c.name === 'mov.pixFmt')?.ok).toBe(false);
    expect(checkMovProbe({ ...info, pixFmt: 'yuva444p12le' }, exp, true).find((c) => c.name === 'mov.pixFmt')?.ok).toBe(false);
  });
});
