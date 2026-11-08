import { describe, expect, it } from 'vitest';
import { rangeFill, rangePercent } from './range.ts';

describe('rangePercent', () => {
  it('maps value onto 0–100', () => {
    expect(rangePercent(0, 0, 449)).toBe(0);
    expect(rangePercent(449, 0, 449)).toBe(100);
    expect(rangePercent(0.5, 0, 1)).toBe(50);
    expect(rangePercent(200, 16, 400)).toBeCloseTo(47.92, 2);
  });

  it('clamps and tolerates bad input', () => {
    expect(rangePercent(-5, 0, 10)).toBe(0);
    expect(rangePercent(50, 0, 10)).toBe(100);
    expect(rangePercent(Number.NaN, 0, 10)).toBe(0);
    expect(rangePercent(3, 0, 0)).toBe(0); // single-frame clip
  });
});

describe('rangeFill', () => {
  it('formats a CSS percentage', () => {
    expect(rangeFill(1, 0, 4)).toBe('25.00%');
  });
});
