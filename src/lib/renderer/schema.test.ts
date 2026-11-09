import { describe, expect, it } from 'vitest';
import {
  canonicalConfigString,
  compactConfig,
  hashConfig,
  isTransparentBackground,
  normalizeConfig,
  renderConfigSchema,
} from './schema.ts';
import { BACKGROUND_PRESETS, DEFAULT_CONFIG } from './types.ts';

const base = { ...DEFAULT_CONFIG } as Record<string, unknown>;
const withOverride = (o: Record<string, unknown>) => ({ ...base, ...o });

describe('renderConfigSchema', () => {
  it('accepts the default config and the spec request example', () => {
    expect(renderConfigSchema.parse(base)).toEqual(DEFAULT_CONFIG);
  });

  it.each([
    ['1280x720', { width: 1280, height: 720 }],
    ['same day', { startDate: '2024-02-29', endDate: '2024-02-29' }],
    ['1s', { durationSeconds: 1 }],
    ['60s', { durationSeconds: 60 }],
    ['12.3s', { durationSeconds: 12.3 }],
    ['float-noisy 0.1 step', { durationSeconds: 0.1 * 3 + 1 }],
    ['24fps', { fps: 24 }],
    ['60fps', { fps: 60 }],
    ['linear', { easing: 'linear' }],
    ['font size bounds', { fontSize: 24 }],
    ['font size max', { fontSize: 240 }],
    ['corner position', { x: 0, y: 1 }],
    ['dot format', { dateFormat: 'YYYY.MM.DD' }],
    ['kanji format', { dateFormat: 'YYYY年MM月DD日' }],
    ['legacy font id', { fontFamily: 'bundled-mono' }],
    ['serif font', { fontFamily: 'noto-serif-jp' }],
    ['digital font', { fontFamily: 'digital' }],
    ['transparent background', { background: 'transparent' }],
    ['green background', { background: '#00FF00' }],
    ['custom lowercase background', { background: '#12abef' }],
  ])('accepts %s', (_name, o) => {
    expect(renderConfigSchema.safeParse(withOverride(o)).success).toBe(true);
  });

  it.each([
    ['2026-02-30', { startDate: '2026-02-30' }],
    ['2023-02-29', { endDate: '2023-02-29' }],
    ['malformed date', { startDate: '2026/03/06' }],
    ['year out of range', { startDate: '0999-12-31' }],
    ['0s', { durationSeconds: 0 }],
    ['0.9s', { durationSeconds: 0.9 }],
    ['61s', { durationSeconds: 61 }],
    ['non 0.1 step', { durationSeconds: 1.05 }],
    ['NaN duration', { durationSeconds: Number.NaN }],
    ['Infinity duration', { durationSeconds: Number.POSITIVE_INFINITY }],
    ['string duration', { durationSeconds: '15' }],
    ['fps 25', { fps: 25 }],
    ['fps string', { fps: '30' }],
    ['3840x2160', { width: 3840, height: 2160 }],
    ['1280x1080 mismatch', { width: 1280, height: 1080 }],
    ['1920x720 mismatch', { width: 1920, height: 720 }],
    ['unknown easing', { easing: 'bounce' }],
    ['unknown font', { fontFamily: 'Comic Sans MS' }],
    ['prototype key font', { fontFamily: 'toString' }],
    ['font size 23', { fontSize: 23 }],
    ['font size 241', { fontSize: 241 }],
    ['font size fractional', { fontSize: 96.5 }],
    ['bad color name', { color: 'white' }],
    ['bad color short', { color: '#FFF' }],
    ['bad color alpha', { color: '#FFFFFFFF' }],
    ['bad color chars', { color: '#GGGGGG' }],
    ['x < 0', { x: -0.01 }],
    ['y > 1', { y: 1.01 }],
    ['extra key', { previewBackground: 'checkerboard' }],
    ['unknown date format', { dateFormat: 'DD/MM/YYYY' }],
    ['date format null', { dateFormat: null }],
    ['font id is a family name', { fontFamily: 'DCS JetBrains Mono' }],
    ['background name', { background: 'green' }],
    ['background short hex', { background: '#0F0' }],
    ['background alpha hex', { background: '#00FF0080' }],
    ['background null', { background: null }],
    ['background TRANSPARENT (case)', { background: 'Transparent' }],
  ])('rejects %s', (_name, o) => {
    expect(renderConfigSchema.safeParse(withOverride(o)).success).toBe(false);
  });

  it('rejects missing keys and non-objects', () => {
    const { color: _c, ...missing } = base;
    expect(renderConfigSchema.safeParse(missing).success).toBe(false);
    expect(renderConfigSchema.safeParse(null).success).toBe(false);
    expect(renderConfigSchema.safeParse('{}').success).toBe(false);
  });
});

describe('dateFormat back-compat', () => {
  it('DEFAULT_CONFIG (new edits) uses slashes', () => {
    expect(DEFAULT_CONFIG.dateFormat).toBe('YYYY/MM/DD');
    expect(renderConfigSchema.parse(base).dateFormat).toBe('YYYY/MM/DD');
  });

  it('a config without dateFormat (old job / old client) parses as the legacy dot format', () => {
    const { dateFormat: _d, ...legacy } = base;
    const parsed = renderConfigSchema.parse(legacy);
    expect(parsed.dateFormat).toBe('YYYY.MM.DD');
    expect(parsed).toEqual({ ...DEFAULT_CONFIG, dateFormat: 'YYYY.MM.DD' });
  });

  it('canonical string always contains dateFormat and the hash depends on it', async () => {
    const { dateFormat: _d, ...legacy } = base;
    expect(JSON.parse(canonicalConfigString(legacy)).dateFormat).toBe('YYYY.MM.DD');
    expect(canonicalConfigString(legacy)).toBe(canonicalConfigString(withOverride({ dateFormat: 'YYYY.MM.DD' })));
    const hashes = await Promise.all(
      (['YYYY.MM.DD', 'YYYY/MM/DD', 'YYYY年MM月DD日'] as const).map((f) => hashConfig(withOverride({ dateFormat: f }))),
    );
    expect(new Set(hashes).size).toBe(3);
  });
});

describe('normalizeConfig / canonicalConfigString / hashConfig', () => {
  it('uppercases color and snaps duration to 0.1', () => {
    const n = normalizeConfig(withOverride({ color: '#ff00aa', durationSeconds: 0.1 * 3 + 1 }));
    expect(n.color).toBe('#FF00AA');
    expect(n.durationSeconds).toBe(1.3);
  });

  it('canonical string is independent of key order and color case', () => {
    const reversed = Object.fromEntries(Object.entries(base).reverse());
    const a = canonicalConfigString(base);
    const b = canonicalConfigString({ ...reversed, color: '#ffffff' });
    expect(a).toBe(b);
    // every key except the default (transparent) background, which is omitted
    expect(Object.keys(JSON.parse(a))).toEqual(Object.keys(base).filter((k) => k !== 'background').sort());
  });

  it('canonicalConfigString throws on invalid config', () => {
    expect(() => canonicalConfigString(withOverride({ fps: 25 }))).toThrow();
  });

  it('hashConfig is stable SHA-256 hex and sensitive to changes', async () => {
    const h1 = await hashConfig(base);
    const h2 = await hashConfig({ ...Object.fromEntries(Object.entries(base).reverse()), color: '#ffffff' });
    const h3 = await hashConfig(withOverride({ fps: 60 }));
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
    expect(h2).toBe(h1);
    expect(h3).not.toBe(h1);
  });
});

describe('background', () => {
  const { background: _b, ...legacy } = base;
  /** Canonical string / hash of DEFAULT_CONFIG as computed BEFORE the background option existed. */
  const PRE_BACKGROUND_CANONICAL =
    '{"color":"#FFFFFF","dateFormat":"YYYY/MM/DD","durationSeconds":10,"easing":"smootherstep","endDate":"2020-01-01",' +
    '"fontFamily":"bundled-mono","fontSize":96,"fps":30,"height":1080,"startDate":"2026-03-06","width":1920,"x":0.5,"y":0.5}';
  const PRE_BACKGROUND_HASH = '34a2d15fc8f6ada1a8d822e73eb4e0d354d7f4e0e41466ccc511194fe9b3195f';

  it('new edits default to transparent; a config without background (old job / old client) parses as transparent', () => {
    expect(DEFAULT_CONFIG.background).toBe('transparent');
    expect(renderConfigSchema.parse(legacy).background).toBe('transparent');
    expect(renderConfigSchema.parse(legacy)).toEqual(DEFAULT_CONFIG);
  });

  it('upper-cases a hex background like color', () => {
    expect(normalizeConfig(withOverride({ background: '#00ff00' })).background).toBe('#00FF00');
  });

  it('exports the 黒 / 白 / グリーン presets', () => {
    expect(BACKGROUND_PRESETS.map((p) => [p.label, p.hex])).toEqual([
      ['黒', '#000000'],
      ['白', '#FFFFFF'],
      ['グリーン', '#00FF00'],
    ]);
  });

  it('hash stability: transparent is omitted, so pre-existing configs keep their exact canonical string and hash', async () => {
    const withTransparent = withOverride({ background: 'transparent' });
    expect(canonicalConfigString(legacy)).toBe(PRE_BACKGROUND_CANONICAL);
    expect(canonicalConfigString(withTransparent)).toBe(PRE_BACKGROUND_CANONICAL);
    expect(canonicalConfigString(withTransparent)).not.toContain('background');
    expect(await hashConfig(legacy)).toBe(PRE_BACKGROUND_HASH);
    expect(await hashConfig(withTransparent)).toBe(PRE_BACKGROUND_HASH);
  });

  it('a solid background is part of the canonical string and changes the hash', async () => {
    const green = withOverride({ background: '#00ff00' });
    expect(JSON.parse(canonicalConfigString(green)).background).toBe('#00FF00');
    expect(canonicalConfigString(green)).toBe(canonicalConfigString(withOverride({ background: '#00FF00' })));
    const hashes = await Promise.all(['transparent', '#000000', '#FFFFFF', '#00FF00'].map((b) => hashConfig(withOverride({ background: b }))));
    expect(new Set(hashes).size).toBe(4);
  });

  it('compactConfig drops only a transparent background and still parses back to the full config', () => {
    expect(compactConfig(base)).not.toHaveProperty('background');
    expect(renderConfigSchema.parse(compactConfig(base))).toEqual(DEFAULT_CONFIG);
    expect(compactConfig(withOverride({ background: '#000000' }))).toHaveProperty('background', '#000000');
  });

  it('isTransparentBackground treats a missing background as transparent', () => {
    expect(isTransparentBackground({})).toBe(true);
    expect(isTransparentBackground({ background: 'transparent' })).toBe(true);
    expect(isTransparentBackground({ background: '#00FF00' })).toBe(false);
  });
});
