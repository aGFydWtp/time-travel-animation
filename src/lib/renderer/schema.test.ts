import { describe, expect, it } from 'vitest';
import { canonicalConfigString, hashConfig, normalizeConfig, renderConfigSchema } from './schema.ts';
import { DEFAULT_CONFIG } from './types.ts';

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
    expect(Object.keys(JSON.parse(a))).toEqual(Object.keys(base).sort());
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
