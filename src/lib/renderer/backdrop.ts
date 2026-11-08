/**
 * Opaque backdrop behind the date: the preview's CSS background and the MP4's composite color.
 * The canvas and the transparent MOV never contain it.
 *
 * Black or white, whichever contrasts more with the text color, so dark text stays visible.
 */
export type Backdrop = '#000000' | '#FFFFFF';

/** WCAG relative luminance of a `#RRGGBB` color (0 = black, 1 = white). */
export function relativeLuminance(hex: string): number {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) throw new Error(`invalid color: ${hex}`);
  const [r, g, b] = [m[1], m[2], m[3]].map((h) => {
    const c = parseInt(h!, 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Black unless white gives the text a higher WCAG contrast ratio. */
export function backdropFor(textColor: string): Backdrop {
  const l = relativeLuminance(textColor);
  const onBlack = (l + 0.05) / 0.05;
  const onWhite = 1.05 / (l + 0.05);
  return onWhite > onBlack ? '#FFFFFF' : '#000000';
}
