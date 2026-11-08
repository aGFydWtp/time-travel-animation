import type { RenderConfig } from './types.ts';

export interface FontDefinition {
  /** CSS family name registered via FontFace. Deliberately unique so a system-installed font can never be matched instead. */
  family: string;
  /** File name under `assets/fonts/`. */
  file: string;
  /** Human-readable label for the UI. */
  label: string;
}

export const FONTS = {
  'bundled-mono': {
    family: 'DCS JetBrains Mono',
    file: 'JetBrainsMono-Regular.woff2',
    label: 'JetBrains Mono',
  },
} as const satisfies Record<string, FontDefinition>;

export type FontId = keyof typeof FONTS;

export const FONT_IDS = Object.keys(FONTS) as FontId[];

export function isFontId(id: string): id is FontId {
  return Object.prototype.hasOwnProperty.call(FONTS, id);
}

export function getFont(id: string): FontDefinition {
  if (!isFontId(id)) throw new RangeError(`Unknown font: ${id}`);
  return FONTS[id];
}

/**
 * Canvas `ctx.font` value. Only the bundled family is named (quoted), with no
 * generic fallback, so a missing font is never silently substituted.
 */
export function fontCss(config: Pick<RenderConfig, 'fontFamily' | 'fontSize'>): string {
  const { family } = getFont(config.fontFamily);
  return `${config.fontSize}px "${family}"`;
}

const loading = new Map<string, Promise<void>>();

/**
 * Register and load a bundled font via the FontFace API, then wait for
 * `document.fonts.ready`. Idempotent per (fontId, fontUrl); a failed load can be retried.
 * Browser-only: touches `document` / `FontFace` only when called.
 */
export function loadFont(fontId: string, fontUrl: string): Promise<void> {
  const font = getFont(fontId);
  const key = `${fontId}\u0000${fontUrl}`;
  const existing = loading.get(key);
  if (existing) return existing;

  const promise = (async () => {
    const face = new FontFace(font.family, `url(${JSON.stringify(fontUrl)})`, {
      style: 'normal',
      weight: '400',
      display: 'block',
    });
    document.fonts.add(face);
    await face.load();
    await document.fonts.ready;
    if (face.status !== 'loaded') {
      throw new Error(`Font failed to load: ${font.family}`);
    }
  })();

  loading.set(key, promise);
  promise.catch(() => loading.delete(key));
  return promise;
}
