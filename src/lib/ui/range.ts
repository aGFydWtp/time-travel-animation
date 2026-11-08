// Fill percentage for the custom-styled range inputs (`--pct` drives the filled track).

/** `value` mapped onto 0–100 between `min` and `max`, clamped; 0 for bad input. */
export function rangePercent(value: number, min: number, max: number): number {
  if (![value, min, max].every(Number.isFinite) || max <= min) return 0;
  return Math.min(100, Math.max(0, ((value - min) / (max - min)) * 100));
}

/** CSS value for `style:--pct`. */
export function rangeFill(value: number, min: number, max: number): string {
  return `${rangePercent(value, min, max).toFixed(2)}%`;
}
