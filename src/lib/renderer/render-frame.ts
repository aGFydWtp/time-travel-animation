import { fontCss } from './fonts.ts';
import { getDateAtFrame } from './frames.ts';
import type { RenderConfig } from './types.ts';

/** Structural subset of CanvasRenderingContext2D used by renderFrame (mockable in tests). */
export type RenderContext = Pick<
  CanvasRenderingContext2D,
  | 'setTransform'
  | 'clearRect'
  | 'fillText'
  | 'font'
  | 'fillStyle'
  | 'textAlign'
  | 'textBaseline'
  | 'globalAlpha'
  | 'globalCompositeOperation'
>;

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
  ctx.fillText(getDateAtFrame(frameIndex, config), config.x * width, config.y * height);
}
