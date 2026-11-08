import type { Easing } from './types.ts';

/** Clamp to [0, 1]. NaN is treated as 0. */
export function clamp01(t: number): number {
  if (Number.isNaN(t) || t <= 0) return 0;
  if (t >= 1) return 1;
  return t;
}

export function linear(t: number): number {
  return clamp01(t);
}

export function smoothstep(t: number): number {
  const x = clamp01(t);
  return x * x * (3 - 2 * x);
}

export function smootherstep(t: number): number {
  const x = clamp01(t);
  return x * x * x * (x * (x * 6 - 15) + 10);
}

export const EASING_FUNCTIONS: Readonly<Record<Easing, (t: number) => number>> = Object.freeze({
  linear,
  smoothstep,
  smootherstep,
});

export function ease(easing: Easing, t: number): number {
  const fn = EASING_FUNCTIONS[easing];
  if (!fn) throw new RangeError(`Unknown easing: ${String(easing)}`);
  return fn(t);
}
