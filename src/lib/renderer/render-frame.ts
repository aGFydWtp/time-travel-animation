import { fontCss } from './fonts.ts';
import { getDateAtFrame } from './frames.ts';
import type { RenderConfig } from './types.ts';

/** Structural subset of CanvasRenderingContext2D used by renderFrame (mockable in tests). */
export type RenderContext = Pick<
  CanvasRenderingContext2D,
  | 'setTransform'
  | 'clearRect'
  | 'fillText'
  | 'measureText'
  | 'font'
  | 'fillStyle'
  | 'textAlign'
  | 'textBaseline'
  | 'globalAlpha'
  | 'globalCompositeOperation'
>;

export interface GlyphPlacement {
  char: string;
  /** Center x of the glyph's cell (draw with textAlign 'center'). */
  x: number;
  width: number;
}

export interface TextLayout {
  glyphs: GlyphPlacement[];
  totalWidth: number;
  digitCellWidth: number;
}

const DIGITS = '0123456789';

/**
 * Tabular layout independent of the font's own digit widths: every digit is centered in a cell as
 * wide as the widest digit ('0'–'9') of the current `ctx.font`; other characters (separators,
 * 年/月/日) take their natural measured width. The whole string is centered on `centerX`, so the
 * total width (and every separator position) is constant while the digits change.
 * Uses only ctx.measureText with the font already set on ctx.
 */
export function layoutTabularText(
  ctx: Pick<CanvasRenderingContext2D, 'measureText'>,
  text: string,
  centerX: number,
): TextLayout {
  let digitCellWidth = 0;
  for (const d of DIGITS) digitCellWidth = Math.max(digitCellWidth, ctx.measureText(d).width);

  const chars = Array.from(text);
  const widths = chars.map((c) => (DIGITS.includes(c) ? digitCellWidth : ctx.measureText(c).width));
  const totalWidth = widths.reduce((a, b) => a + b, 0);

  let cursor = centerX - totalWidth / 2;
  const glyphs = chars.map((char, i) => {
    const width = widths[i]!;
    const glyph = { char, x: cursor + width / 2, width };
    cursor += width;
    return glyph;
  });
  return { glyphs, totalWidth, digitCellWidth };
}

/**
 * Draw one frame onto a transparent canvas of size config.width x config.height.
 * Deterministic: depends only on (frameIndex, config). Never fills a background.
 */
export function renderFrame(ctx: RenderContext, frameIndex: number, config: RenderConfig): void {
  const { width, height } = config;

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, width, height);

  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  ctx.font = fontCss(config);
  ctx.fillStyle = config.color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const y = config.y * height;
  const layout = layoutTabularText(ctx, getDateAtFrame(frameIndex, config), config.x * width);
  for (const g of layout.glyphs) ctx.fillText(g.char, g.x, y);
}
