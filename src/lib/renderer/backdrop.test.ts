import { describe, expect, it } from 'vitest';
import { backdropFor, relativeLuminance } from './backdrop.ts';

describe('relativeLuminance', () => {
  it('is 0 for black and 1 for white', () => {
    expect(relativeLuminance('#000000')).toBe(0);
    expect(relativeLuminance('#FFFFFF')).toBeCloseTo(1, 10);
    expect(relativeLuminance('#ffffff')).toBeCloseTo(1, 10);
  });

  it('rejects anything but #RRGGBB', () => {
    expect(() => relativeLuminance('#FFF')).toThrow();
    expect(() => relativeLuminance('red')).toThrow();
  });
});

describe('backdropFor', () => {
  it('puts light text on black (the default white text keeps the black backdrop)', () => {
    for (const c of ['#FFFFFF', '#FFFF00', '#00FF00', '#FF8800', '#AAAAAA']) {
      expect(backdropFor(c)).toBe('#000000');
    }
  });

  it('puts dark text on white', () => {
    for (const c of ['#000000', '#222222', '#0000FF', '#800000', '#333366']) {
      expect(backdropFor(c)).toBe('#FFFFFF');
    }
  });

  it('switches where the contrast against white overtakes black', () => {
    // Luminance ≈ 0.179 is the crossover; #757575 (L≈0.178) is just below it, #767676 (L≈0.181) above.
    expect(backdropFor('#757575')).toBe('#FFFFFF');
    expect(backdropFor('#767676')).toBe('#000000');
  });
});
