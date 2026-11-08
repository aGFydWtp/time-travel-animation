// Browser bundle loaded by render-page.html inside the container's headless Chromium.
// Uses the SAME shared renderer as the editor preview (src/lib/renderer) — no drawing code here.
import {
  fontCss,
  fontFaces,
  formatDisplayDate,
  getTotalFrames,
  layoutTabularText,
  textWidthEm,
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
  /** Measured width (px, at config.fontSize) of the drawn date; equals textWidthEm * fontSize. */
  textWidth: number;
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
/** Two different generic fallbacks: a substituted glyph would match at least one of them. */
const FALLBACKS = ['serif', 'monospace'] as const;

function measure(context: CanvasRenderingContext2D, font: string, text: string): number {
  context.font = font;
  return context.measureText(text).width;
}

/**
 * Guard against silent fallback, per face: text drawn with the face must measure differently from
 * the same text in BOTH generic fallbacks (whatever the browser would substitute). The primary
 * face is probed with digits/separators (and kanji when it is the only face); later faces with 年月日.
 */
function assertBundledGlyphs(context: CanvasRenderingContext2D, fontId: string): void {
  const size = 100;
  const faces = fontFaces(fontId);
  faces.forEach((face, i) => {
    const texts = i > 0 ? ['年月日'] : faces.length === 1 ? ['0123456789./', '年月日'] : ['0123456789./'];
    for (const text of texts) {
      const used = measure(context, `${size}px "${face.family}"`, text);
      const clash = FALLBACKS.find((g) => Math.abs(used - measure(context, `${size}px ${g}`, text)) < 0.5);
      if (!(used > 0) || clash) {
        throw new Error(`Bundled font not used for ${JSON.stringify(text)}: ${face.family}${clash ? ` (= ${clash})` : ''}`);
      }
    }
  });
}

/**
 * The drawn width must match the advance table in fonts.ts (used by output verification for the
 * text box). Throws when the table is stale for a font file.
 */
function measureTextWidth(context: CanvasRenderingContext2D, cfg: RenderConfig): number {
  context.font = fontCss(cfg);
  context.letterSpacing = '0px';
  context.fontKerning = 'normal';
  context.fontStretch = 'normal';
  const measured = layoutTabularText(context, formatDisplayDate(0, cfg.dateFormat), 0).totalWidth;
  const expected = textWidthEm(cfg.fontFamily, cfg.dateFormat) * cfg.fontSize;
  if (Math.abs(measured - expected) > Math.max(1, expected * 0.005)) {
    throw new Error(`Text width ${measured.toFixed(2)}px != font metrics ${expected.toFixed(2)}px (${cfg.fontFamily})`);
  }
  return measured;
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
    const textWidth = measureTextWidth(context, parsed);

    ctx = context;
    config = parsed;
    api.totalFrames = getTotalFrames(parsed);
    return {
      totalFrames: api.totalFrames,
      width: canvas.width,
      height: canvas.height,
      fontFamily: faces.map((f) => f.family).join(', '),
      textWidth,
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
