// Output verification: ffprobe stream checks + decoded-pixel alpha / background checks.
// Runs inside the container (called by render-entry) and from tests on the host.
import { open } from 'node:fs/promises';
import { textWidthEm } from '../src/lib/renderer/fonts.ts';
import type { RenderConfig } from '../src/lib/renderer/types.ts';
import { run } from './proc.ts';

/** Command prefixes, e.g. ['ffprobe'] or ['docker', 'run', ..., 'ffprobe']. */
export interface Tools {
  ffmpeg: readonly string[];
  ffprobe: readonly string[];
}

export const DEFAULT_TOOLS: Tools = { ffmpeg: ['ffmpeg'], ffprobe: ['ffprobe'] };

export interface ProbeInfo {
  codec: string;
  profile: string | null;
  pixFmt: string;
  width: number;
  height: number;
  fps: number;
  frames: number;
  durationSeconds: number;
  formatName: string;
  bytes: number;
}

export interface CheckResult {
  name: string;
  ok: boolean;
  detail: string;
}

export interface ExpectedVideo {
  width: number;
  height: number;
  fps: number;
  totalFrames: number;
}

function parseRate(rate: unknown): number {
  if (typeof rate !== 'string') return Number.NaN;
  const [n, d] = rate.split('/').map(Number);
  return d ? n / d : n;
}

export async function probe(file: string, tools: Tools = DEFAULT_TOOLS): Promise<ProbeInfo> {
  const { stdout } = await run([
    ...tools.ffprobe,
    '-v', 'error',
    '-select_streams', 'v:0',
    '-show_entries',
    'stream=codec_name,profile,pix_fmt,width,height,r_frame_rate,avg_frame_rate,nb_frames,duration:format=duration,size,format_name',
    '-of', 'json',
    file,
  ]);
  const json = JSON.parse(stdout.toString('utf8')) as {
    streams?: Record<string, unknown>[];
    format?: Record<string, unknown>;
  };
  const s = json.streams?.[0];
  if (!s) throw new Error(`No video stream in ${file}`);
  const f = json.format ?? {};
  const fps = parseRate(s.avg_frame_rate) || parseRate(s.r_frame_rate);
  const duration = Number(s.duration ?? f.duration);
  let frames = Number(s.nb_frames);
  if (!Number.isFinite(frames) || frames <= 0) frames = await countFrames(file, tools);
  return {
    codec: String(s.codec_name),
    profile: s.profile == null ? null : String(s.profile),
    pixFmt: String(s.pix_fmt),
    width: Number(s.width),
    height: Number(s.height),
    fps,
    frames,
    durationSeconds: duration,
    formatName: String(f.format_name ?? ''),
    bytes: Number(f.size),
  };
}

async function countFrames(file: string, tools: Tools): Promise<number> {
  const { stdout } = await run([
    ...tools.ffprobe, '-v', 'error', '-select_streams', 'v:0', '-count_frames',
    '-show_entries', 'stream=nb_read_frames', '-of', 'csv=p=0', file,
  ]);
  return Number(stdout.toString('utf8').trim());
}

function check(name: string, ok: boolean, detail: string): CheckResult {
  return { name, ok, detail };
}

function commonChecks(prefix: string, info: ProbeInfo, exp: ExpectedVideo): CheckResult[] {
  const expectedDuration = exp.totalFrames / exp.fps;
  const frameTime = 1 / exp.fps;
  return [
    check(`${prefix}.size`, info.width === exp.width && info.height === exp.height,
      `${info.width}x${info.height} (expected ${exp.width}x${exp.height})`),
    check(`${prefix}.fps`, Math.abs(info.fps - exp.fps) < 0.01, `${info.fps} (expected ${exp.fps})`),
    check(`${prefix}.frames`, info.frames === exp.totalFrames, `${info.frames} (expected ${exp.totalFrames})`),
    check(`${prefix}.duration`, Math.abs(info.durationSeconds - expectedDuration) <= frameTime + 1e-6,
      `${info.durationSeconds}s (expected ${expectedDuration}s ±1 frame)`),
  ];
}

export function checkMp4Probe(info: ProbeInfo, exp: ExpectedVideo): CheckResult[] {
  return [
    ...commonChecks('mp4', info, exp),
    check('mp4.codec', info.codec === 'h264', info.codec),
    check('mp4.pixFmt', info.pixFmt === 'yuv420p', info.pixFmt),
  ];
}

const MOV_ALPHA_PIX_FMTS = ['yuva444p10le', 'yuva444p12le', 'yuva444p16le'];

export function checkMovProbe(info: ProbeInfo, exp: ExpectedVideo): CheckResult[] {
  return [
    ...commonChecks('mov', info, exp),
    check('mov.codec', info.codec === 'prores', info.codec),
    check('mov.profile', (info.profile ?? '').startsWith('4444'), String(info.profile)),
    check('mov.pixFmt', MOV_ALPHA_PIX_FMTS.includes(info.pixFmt), info.pixFmt),
  ];
}

/** True when the top-level `moov` atom precedes `mdat` (i.e. +faststart). */
export async function isFaststart(file: string): Promise<boolean> {
  const fh = await open(file, 'r');
  try {
    const { size } = await fh.stat();
    const header = Buffer.alloc(16);
    let offset = 0;
    while (offset + 8 <= size) {
      await fh.read(header, 0, 16, offset);
      let boxSize = header.readUInt32BE(0);
      const type = header.toString('latin1', 4, 8);
      if (type === 'moov') return true;
      if (type === 'mdat') return false;
      if (boxSize === 1) boxSize = Number(header.readBigUInt64BE(8));
      else if (boxSize === 0) return false;
      if (boxSize < 8) return false;
      offset += boxSize;
    }
    return false;
  } finally {
    await fh.close();
  }
}

/** Decode a single frame (0-based index) to raw pixels. Works for videos and still images. */
export async function extractFrame(
  file: string,
  frameIndex: number,
  width: number,
  height: number,
  pixFmt: 'rgba' | 'rgb24',
  tools: Tools = DEFAULT_TOOLS,
): Promise<Buffer> {
  const { stdout } = await run([
    ...tools.ffmpeg,
    '-v', 'error', '-nostdin',
    '-i', file,
    // The comma inside eq() must be escaped for the filtergraph parser (no shell involved).
    '-vf', `select=eq(n\\,${frameIndex})`,
    '-frames:v', '1',
    '-f', 'rawvideo', '-pix_fmt', pixFmt,
    'pipe:1',
  ]);
  const channels = pixFmt === 'rgba' ? 4 : 3;
  const expected = width * height * channels;
  if (stdout.length !== expected) {
    throw new Error(`extractFrame: got ${stdout.length} bytes, expected ${expected} (frame ${frameIndex} of ${file})`);
  }
  return stdout;
}

export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

type TextBoxConfig = Pick<RenderConfig, 'width' | 'height' | 'x' | 'y' | 'fontSize' | 'fontFamily' | 'dateFormat'>;

/** Margin beyond the advance width: glyph overhang (<= 0.04em in the bundled fonts) + antialiasing. */
const TEXT_BOX_MARGIN_EM = 0.15;

/**
 * Box around where the date text is drawn (centered at x*width, y*height). The width is the
 * actual drawn width from the bundled fonts' advance table (textWidthEm — tabular digits, so it
 * does not depend on the date; the render page asserts it against measureText), plus a margin.
 * Vertically, every bundled glyph stays within ±0.65em of the 'middle' baseline.
 */
export function textBox(config: TextBoxConfig): Box {
  const cx = config.x * config.width;
  const cy = config.y * config.height;
  const halfW = (textWidthEm(config.fontFamily, config.dateFormat) / 2 + TEXT_BOX_MARGIN_EM) * config.fontSize + 2;
  const halfH = config.fontSize * 0.8;
  return {
    x0: Math.max(0, Math.floor(cx - halfW)),
    y0: Math.max(0, Math.floor(cy - halfH)),
    x1: Math.min(config.width, Math.ceil(cx + halfW)),
    y1: Math.min(config.height, Math.ceil(cy + halfH)),
  };
}

const CORNER = 16;

function cornerBoxes(width: number, height: number): Box[] {
  return [
    { x0: 0, y0: 0, x1: CORNER, y1: CORNER },
    { x0: width - CORNER, y0: 0, x1: width, y1: CORNER },
    { x0: 0, y0: height - CORNER, x1: CORNER, y1: height },
    { x0: width - CORNER, y0: height - CORNER, x1: width, y1: height },
  ];
}

function intersects(a: Box, b: Box): boolean {
  return a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
}

export interface AlphaStats {
  cornersChecked: number;
  cornerMaxAlpha: number;
  textPixels: number;
  textMaxAlpha: number;
  transparentFraction: number;
  /** Mean RGB of fully opaque pixels in the text box (null if none). */
  opaqueMeanRgb: [number, number, number] | null;
}

export function alphaStats(rgba: Buffer, config: TextBoxConfig): AlphaStats {
  const { width, height } = config;
  const box = textBox(config);
  let cornersChecked = 0;
  let cornerMaxAlpha = 0;
  for (const c of cornerBoxes(width, height)) {
    if (intersects(c, box)) continue;
    cornersChecked++;
    for (let y = c.y0; y < c.y1; y++) {
      for (let x = c.x0; x < c.x1; x++) {
        cornerMaxAlpha = Math.max(cornerMaxAlpha, rgba[(y * width + x) * 4 + 3]);
      }
    }
  }

  let textPixels = 0;
  let textMaxAlpha = 0;
  let opaque = 0;
  const sum = [0, 0, 0];
  for (let y = box.y0; y < box.y1; y++) {
    for (let x = box.x0; x < box.x1; x++) {
      const i = (y * width + x) * 4;
      const a = rgba[i + 3];
      if (a > 0) textPixels++;
      if (a > textMaxAlpha) textMaxAlpha = a;
      if (a === 255) {
        opaque++;
        sum[0] += rgba[i];
        sum[1] += rgba[i + 1];
        sum[2] += rgba[i + 2];
      }
    }
  }

  let transparent = 0;
  for (let i = 3; i < rgba.length; i += 4) if (rgba[i] === 0) transparent++;

  return {
    cornersChecked,
    cornerMaxAlpha,
    textPixels,
    textMaxAlpha,
    transparentFraction: transparent / (width * height),
    opaqueMeanRgb: opaque ? [sum[0] / opaque, sum[1] / opaque, sum[2] / opaque] : null,
  };
}

function hexToRgb(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Assertions on a decoded RGBA frame from the transparent MOV. */
export function checkAlphaFrame(stats: AlphaStats, config: RenderConfig): CheckResult[] {
  const minTextPixels = Math.max(20, Math.round(config.fontSize * config.fontSize * 0.05));
  const results = [
    check('mov.alpha.cornersTransparent', stats.cornersChecked > 0 && stats.cornerMaxAlpha === 0,
      `${stats.cornersChecked} corners, max alpha ${stats.cornerMaxAlpha}`),
    check('mov.alpha.backgroundTransparent', stats.transparentFraction >= 0.5,
      `transparent fraction ${stats.transparentFraction.toFixed(4)}`),
    check('mov.alpha.textOpaque', stats.textPixels >= minTextPixels && stats.textMaxAlpha >= 250,
      `${stats.textPixels} px alpha>0 (min ${minTextPixels}), max alpha ${stats.textMaxAlpha}`),
  ];
  const expected = hexToRgb(config.color);
  const mean = stats.opaqueMeanRgb;
  const colorOk = mean !== null && mean.every((v, i) => Math.abs(v - expected[i]) <= 12);
  results.push(check('mov.textColor', colorOk,
    `opaque mean RGB ${mean ? mean.map((v) => v.toFixed(1)).join(',') : 'n/a'} (expected ${config.color})`));
  return results;
}

/** MP4 corners (outside the text box) must be black after the over-black composite. */
export function checkMp4Black(rgb: Buffer, config: RenderConfig): CheckResult {
  const { width, height } = config;
  const box = textBox(config);
  let checked = 0;
  let max = 0;
  for (const c of cornerBoxes(width, height)) {
    if (intersects(c, box)) continue;
    checked++;
    for (let y = c.y0; y < c.y1; y++) {
      for (let x = c.x0; x < c.x1; x++) {
        const i = (y * width + x) * 3;
        max = Math.max(max, rgb[i], rgb[i + 1], rgb[i + 2]);
      }
    }
  }
  return check('mp4.backgroundBlack', checked > 0 && max <= 6, `${checked} corners, max channel ${max}`);
}

export interface VerifyReport {
  ok: boolean;
  checks: CheckResult[];
  mp4: ProbeInfo;
  mov: ProbeInfo;
  sampleFrame: number;
  alpha: AlphaStats;
}

export async function verifyOutputs(
  paths: { mp4: string; mov: string },
  config: RenderConfig,
  totalFrames: number,
  tools: Tools = DEFAULT_TOOLS,
): Promise<VerifyReport> {
  const exp: ExpectedVideo = { width: config.width, height: config.height, fps: config.fps, totalFrames };
  const [mp4, mov] = await Promise.all([probe(paths.mp4, tools), probe(paths.mov, tools)]);
  const checks = [...checkMp4Probe(mp4, exp), ...checkMovProbe(mov, exp)];
  checks.push(check('mp4.faststart', await isFaststart(paths.mp4), 'moov before mdat'));

  const sampleFrame = Math.floor(totalFrames / 2);
  const [movRgba, mp4Rgb] = await Promise.all([
    extractFrame(paths.mov, sampleFrame, config.width, config.height, 'rgba', tools),
    extractFrame(paths.mp4, sampleFrame, config.width, config.height, 'rgb24', tools),
  ]);
  const alpha = alphaStats(movRgba, config);
  checks.push(...checkAlphaFrame(alpha, config), checkMp4Black(mp4Rgb, config));

  return { ok: checks.every((c) => c.ok), checks, mp4, mov, sampleFrame, alpha };
}
