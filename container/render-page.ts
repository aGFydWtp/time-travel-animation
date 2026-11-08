// Browser bundle loaded by render-page.html inside the container's headless Chromium.
// Uses the SAME shared renderer as the editor preview (src/lib/renderer) — no drawing code here.
import {
  fontCss,
  getFont,
  getTotalFrames,
  loadFont,
  parseRenderConfig,
  renderFrame,
  type RenderConfig,
} from '../src/lib/renderer/index.ts';

export interface DcsInitResult {
  totalFrames: number;
  width: number;
  height: number;
  fontFamily: string;
}

export interface DcsPageApi {
  /** Validate the config, load the bundled font (relative URL), size the canvas. */
  init(input: unknown): Promise<DcsInitResult>;
  /** Draw frame `i` and return the canvas as a PNG data URL (alpha preserved). */
  renderFrameToPng(frameIndex: number): string;
  totalFrames: number;
}

declare global {
  interface Window {
    __dcs: DcsPageApi;
  }
}

const canvas = document.getElementById('canvas') as HTMLCanvasElement;
let ctx: CanvasRenderingContext2D | null = null;
let config: RenderConfig | null = null;

const api: DcsPageApi = {
  totalFrames: 0,

  async init(input) {
    const parsed = parseRenderConfig(input);
    const font = getFont(parsed.fontFamily);
    // Relative to render-page.html; the font file is copied next to it in container/dist.
    await loadFont(parsed.fontFamily, `./${font.file}`);
    await document.fonts.ready;
    if (!document.fonts.check(fontCss(parsed))) {
      throw new Error(`Font not available after load: ${font.family}`);
    }

    canvas.width = parsed.width;
    canvas.height = parsed.height;
    const context = canvas.getContext('2d', { alpha: true });
    if (!context) throw new Error('2D canvas context unavailable');

    ctx = context;
    config = parsed;
    api.totalFrames = getTotalFrames(parsed);
    return {
      totalFrames: api.totalFrames,
      width: canvas.width,
      height: canvas.height,
      fontFamily: font.family,
    };
  },

  renderFrameToPng(frameIndex) {
    if (!ctx || !config) throw new Error('init() has not completed');
    if (!Number.isInteger(frameIndex) || frameIndex < 0 || frameIndex >= api.totalFrames) {
      throw new RangeError(`frameIndex out of range: ${frameIndex}`);
    }
    renderFrame(ctx, frameIndex, config);
    return canvas.toDataURL('image/png');
  },
};

window.__dcs = api;
