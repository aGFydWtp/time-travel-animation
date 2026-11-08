// Browser bundle loaded by render-page.html inside the container's headless Chromium.
// Uses the SAME shared renderer as the editor preview (src/lib/renderer) — no drawing code here.
import {
  fontCss,
  fontFaces,
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

/** Every character any date format can draw. */
const GLYPH_PROBE = '0123456789./年月日';
const MISSING_FAMILY = '"DCS Font That Does Not Exist"';

/**
 * Guard against silent fallback, per face: text drawn with the face must measure differently from
 * the same text in a non-existent family (= whatever the browser substitutes). The primary face is
 * probed with digits/separators (and kanji when it is the only face); later faces with 年月日.
 */
function assertBundledGlyphs(context: CanvasRenderingContext2D, fontId: string): void {
  const size = 100;
  const measure = (font: string, text: string) => {
    context.font = font;
    return context.measureText(text).width;
  };
  const faces = fontFaces(fontId);
  faces.forEach((face, i) => {
    const texts = i > 0 ? ['年月日'] : faces.length === 1 ? ['0123456789./', '年月日'] : ['0123456789./'];
    for (const text of texts) {
      const used = measure(`${size}px "${face.family}"`, text);
      const substituted = measure(`${size}px ${MISSING_FAMILY}`, text);
      if (!(used > 0) || Math.abs(used - substituted) < 0.5) {
        throw new Error(`Bundled font not used for ${JSON.stringify(text)}: ${face.family}`);
      }
    }
  });
}

const canvas = document.getElementById('canvas') as HTMLCanvasElement;
let ctx: CanvasRenderingContext2D | null = null;
let config: RenderConfig | null = null;

const api: DcsPageApi = {
  totalFrames: 0,

  async init(input) {
    const parsed = parseRenderConfig(input);
    const faces = fontFaces(parsed.fontFamily);
    // Relative to render-page.html; the font files are copied next to it in container/dist.
    await loadFont(parsed.fontFamily, (file) => `./${file}`);
    await document.fonts.ready;
    if (!document.fonts.check(fontCss(parsed), GLYPH_PROBE)) {
      throw new Error(`Font not available after load: ${faces.map((f) => f.family).join(', ')}`);
    }

    canvas.width = parsed.width;
    canvas.height = parsed.height;
    const context = canvas.getContext('2d', { alpha: true });
    if (!context) throw new Error('2D canvas context unavailable');
    assertBundledGlyphs(context, parsed.fontFamily);

    ctx = context;
    config = parsed;
    api.totalFrames = getTotalFrames(parsed);
    return {
      totalFrames: api.totalFrames,
      width: canvas.width,
      height: canvas.height,
      fontFamily: faces.map((f) => f.family).join(', '),
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
