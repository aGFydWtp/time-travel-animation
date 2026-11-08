import { describe, expect, it } from 'vitest';
import { clamp01, ease, EASING_FUNCTIONS } from './easing.ts';
import { EASINGS } from './types.ts';

describe('easing', () => {
  it.each(EASINGS)('%s maps 0->0, 1->1 and clamps outside [0,1]', (name) => {
    expect(ease(name, 0)).toBe(0);
    expect(ease(name, 1)).toBe(1);
    expect(ease(name, -5)).toBe(0);
    expect(ease(name, 7)).toBe(1);
    expect(ease(name, Number.NaN)).toBe(0);
    expect(ease(name, 0.5)).toBeCloseTo(0.5, 12);
  });

  it.each(EASINGS)('%s is monotonic non-decreasing on [0,1]', (name) => {
    const fn = EASING_FUNCTIONS[name];
    let prev = fn(0);
    for (let i = 1; i <= 10_000; i++) {
      const v = fn(i / 10_000);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });

  it('matches the spec formulas', () => {
    const t = 0.3;
    expect(ease('linear', t)).toBe(t);
    expect(ease('smoothstep', t)).toBeCloseTo(t * t * (3 - 2 * t), 15);
    expect(ease('smootherstep', t)).toBeCloseTo(6 * t ** 5 - 15 * t ** 4 + 10 * t ** 3, 15);
  });

  it('clamp01', () => {
    expect(clamp01(-0.1)).toBe(0);
    expect(clamp01(0.25)).toBe(0.25);
    expect(clamp01(1.0000001)).toBe(1);
  });
});
