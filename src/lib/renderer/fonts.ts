import { formatDisplayDate } from './calendar.ts';
import type { DateFormat, RenderConfig } from './types.ts';

/** One bundled font file registered via FontFace. */
export interface FontFaceDefinition {
  /** CSS family name registered via FontFace. Deliberately unique ("DCS …") so a system-installed font can never be matched instead. */
  family: string;
  /** File name under `assets/fonts/` (copied flat next to the container render page). */
  file: string;
  /**
   * Advance widths in em (hmtx / unitsPerEm, read from the bundled file with fonttools) of the
   * characters a date can contain; `digit` is the widest of 0-9. `kanji` (年/月/日, all 1em) is
   * absent when the face has no such glyphs. Used to know the drawn text width without a canvas
   * (output verification); the render page checks it against measureText on every render.
   */
  advances: { digit: number; '.': number; '/': number; kanji?: number };
}

/** A selectable font: ordered faces (first = primary, later = glyph fallback, all bundled). */
export interface FontDefinition {
  /** Human-readable label for the UI. */
  label: string;
  faces: readonly FontFaceDefinition[];
}

// Faces. All files except JetBrains Mono are subsets containing only `0-9 . / 年 月 日` and space
// (see assets/fonts/README.md for sources, licenses and how they were built).
const JETBRAINS_MONO = {
  family: 'DCS JetBrains Mono',
  file: 'JetBrainsMono-Regular.woff2',
  advances: { digit: 0.6, '.': 0.6, '/': 0.6 },
} as const satisfies FontFaceDefinition;
const NOTO_SANS_JP = {
  family: 'DCS Noto Sans JP',
  file: 'NotoSansJP-DateGlyphs.woff2',
  advances: { digit: 0.555, '.': 0.278, '/': 0.392, kanji: 1 },
} as const satisfies FontFaceDefinition;
const NOTO_SERIF_JP = {
  family: 'DCS Noto Serif JP',
  file: 'NotoSerifJP-DateGlyphs.woff2',
  advances: { digit: 0.562, '.': 0.327, '/': 0.352, kanji: 1 },
} as const satisfies FontFaceDefinition;
const ZEN_MARU_GOTHIC = {
  family: 'DCS Zen Maru Gothic',
  file: 'ZenMaruGothic-DateGlyphs.woff2',
  advances: { digit: 0.509, '.': 0.243, '/': 0.546, kanji: 1 },
} as const satisfies FontFaceDefinition;
const KLEE_ONE = {
  family: 'DCS Klee One',
  file: 'KleeOne-DateGlyphs.woff2',
  advances: { digit: 0.6, '.': 0.35, '/': 0.35, kanji: 1 },
} as const satisfies FontFaceDefinition;
const DELA_GOTHIC_ONE = {
  family: 'DCS Dela Gothic One',
  file: 'DelaGothicOne-DateGlyphs.woff2',
  advances: { digit: 0.924, '.': 0.272, '/': 0.499, kanji: 1 },
} as const satisfies FontFaceDefinition;
const DOTGOTHIC16 = {
  family: 'DCS DotGothic16',
  file: 'DotGothic16-DateGlyphs.woff2',
  advances: { digit: 0.5, '.': 0.5, '/': 0.5, kanji: 1 },
} as const satisfies FontFaceDefinition;
// Subset of Orbitron, renamed: Orbitron is a Reserved Font Name and must not name a modified version.
const DCS_DIGITAL = {
  family: 'DCS Digital',
  file: 'DCSDigital-DateGlyphs.woff2',
  advances: { digit: 0.834, '.': 0.214, '/': 0.521 },
} as const satisfies FontFaceDefinition;

/** Glyph face that supplies 年/月/日 for fonts that lack them. */
export const DATE_GLYPHS_FACE: FontFaceDefinition = NOTO_SANS_JP;

export const FONTS = {
  // id kept for back-compat: stored jobs reference 'bundled-mono'.
  'bundled-mono': { label: '等幅（JetBrains Mono）', faces: [JETBRAINS_MONO, NOTO_SANS_JP] },
  'noto-sans-jp': { label: 'ゴシック（Noto Sans JP）', faces: [NOTO_SANS_JP] },
  'noto-serif-jp': { label: '明朝（Noto Serif JP）', faces: [NOTO_SERIF_JP] },
  'zen-maru-gothic': { label: '丸ゴシック（Zen Maru Gothic）', faces: [ZEN_MARU_GOTHIC] },
  'klee-one': { label: '手書き風（Klee One）', faces: [KLEE_ONE] },
  'dela-gothic-one': { label: '極太（Dela Gothic One）', faces: [DELA_GOTHIC_ONE] },
  dotgothic16: { label: 'ドット（DotGothic16）', faces: [DOTGOTHIC16] },
  digital: { label: 'デジタル', faces: [DCS_DIGITAL, NOTO_SANS_JP] },
} as const satisfies Record<string, FontDefinition>;

export type FontId = keyof typeof FONTS;

export const FONT_IDS = Object.keys(FONTS) as FontId[];

/** Every bundled font file name (deduplicated), e.g. for copying into the container bundle. */
export const FONT_FILES: readonly string[] = [
  ...new Set(Object.values(FONTS).flatMap((f) => f.faces.map((face) => face.file))),
];

export function isFontId(id: string): id is FontId {
  return Object.prototype.hasOwnProperty.call(FONTS, id);
}

export function getFont(id: string): FontDefinition {
  if (!isFontId(id)) throw new RangeError(`Unknown font: ${id}`);
  return FONTS[id];
}

/** Ordered faces of a font (first = primary). */
export function fontFaces(fontId: string): readonly FontFaceDefinition[] {
  return getFont(fontId).faces;
}

/**
 * Canvas `ctx.font` value: an explicit stack of the font's bundled families only (quoted, no
 * generic fallback), so a missing glyph or font is never silently substituted by a platform font.
 */
export function fontCss(config: Pick<RenderConfig, 'fontFamily' | 'fontSize'>): string {
  const families = fontFaces(config.fontFamily).map((f) => `"${f.family}"`);
  return `${config.fontSize}px ${families.join(', ')}`;
}

/**
 * Width in em of a date drawn by renderFrame (tabular digits, see layoutTabularText) with this
 * font and format. Independent of the date itself. Each character resolves to the first face in
 * the stack that has it, like the browser's per-character font fallback.
 */
export function textWidthEm(fontId: string, format: DateFormat): number {
  const faces = fontFaces(fontId);
  let width = 0;
  for (const c of formatDisplayDate(0, format)) {
    let adv: number | undefined;
    if (c >= '0' && c <= '9') adv = faces[0]!.advances.digit;
    else if (c === '.' || c === '/') adv = faces[0]!.advances[c];
    else adv = faces.find((f) => f.advances.kanji !== undefined)?.advances.kanji;
    if (adv === undefined) throw new Error(`No bundled glyph for ${JSON.stringify(c)} in font ${fontId}`);
    width += adv;
  }
  return width;
}

let fontEpoch = 0;

/** Incremented whenever a bundled face finishes loading (invalidates measurement caches). */
export function getFontEpoch(): number {
  return fontEpoch;
}

/** Maps a bundled font file name (FONT_FILES entry) to a URL the browser can fetch. */
export type FontUrlResolver = (file: string) => string;

const loading = new Map<string, Promise<void>>();

function loadFace(face: FontFaceDefinition, url: string): Promise<void> {
  const key = `${face.family}\u0000${url}`;
  const existing = loading.get(key);
  if (existing) return existing;

  const promise = (async () => {
    const fontFace = new FontFace(face.family, `url(${JSON.stringify(url)})`, {
      style: 'normal',
      weight: '400',
      display: 'block',
    });
    document.fonts.add(fontFace);
    try {
      await fontFace.load();
      if (fontFace.status !== 'loaded') throw new Error(`Font failed to load: ${face.family}`);
    } catch (err) {
      document.fonts.delete(fontFace); // a retry registers a fresh face
      throw err;
    } finally {
      fontEpoch++;
    }
  })();

  loading.set(key, promise);
  promise.catch(() => loading.delete(key));
  return promise;
}

/**
 * Register and load every face of `fontId` via the FontFace API (lazily, per font id), then wait
 * for `document.fonts.ready`. Idempotent per (face, url); a failed load can be retried.
 * Browser-only: touches `document` / `FontFace` only when called.
 */
export async function loadFont(fontId: string, resolveUrl: FontUrlResolver): Promise<void> {
  const faces = fontFaces(fontId);
  await Promise.all(
    faces.map((face) => {
      const url = resolveUrl(face.file);
      if (!url) return Promise.reject(new Error(`No URL for font file: ${face.file}`));
      return loadFace(face, url);
    }),
  );
  await document.fonts.ready;
}
