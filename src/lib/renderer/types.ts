export type Fps = 24 | 30 | 60;
export type OutputWidth = 1280 | 1920;
export type OutputHeight = 720 | 1080;
export type Easing = 'linear' | 'smoothstep' | 'smootherstep';

/** Selectable display formats for the rendered date. Month/day are always zero-padded. */
export const DATE_FORMATS = ['YYYY.MM.DD', 'YYYY/MM/DD', 'YYYY年MM月DD日'] as const;
export type DateFormat = (typeof DATE_FORMATS)[number];

/**
 * Format assumed when a stored/submitted config has no `dateFormat` (configs created before the
 * option existed were rendered with dots). Intentionally different from DEFAULT_CONFIG.dateFormat,
 * which is what NEW edits start with.
 */
export const LEGACY_DATE_FORMAT: DateFormat = 'YYYY.MM.DD';

/**
 * Video background. 'transparent' = ProRes 4444 MOV with alpha (the MP4 gets the automatic
 * black/white backdrop). A `#RRGGBB` colour = both the MP4 and an opaque ProRes 4444 MOV are
 * composited over that colour (for editors that can't read alpha, e.g. CapCut: green + chroma key).
 */
export type Background = 'transparent' | `#${string}`;

/** Assumed when a stored/submitted config has no `background` (configs from before the option). */
export const DEFAULT_BACKGROUND = 'transparent' satisfies Background;

/** Named solid backgrounds offered in the editor (any other #RRGGBB is 好きな色). */
export const BACKGROUND_PRESETS = [
  { key: 'black', label: '黒', hex: '#000000' },
  { key: 'white', label: '白', hex: '#FFFFFF' },
  { key: 'green', label: 'グリーン', hex: '#00FF00' },
] as const satisfies readonly { key: string; label: string; hex: Background }[];

export interface RenderConfig {
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  durationSeconds: number;
  fps: Fps;
  width: OutputWidth;
  height: OutputHeight;
  easing: Easing;
  dateFormat: DateFormat;
  fontFamily: string; // bundled font identifier (key of FONTS)
  fontSize: number; // output pixels
  color: string; // #RRGGBB
  background: Background;
  x: number; // 0..1
  y: number; // 0..1
}

export const FPS_OPTIONS = [24, 30, 60] as const satisfies readonly Fps[];

export const RESOLUTIONS = [
  { width: 1280, height: 720 },
  { width: 1920, height: 1080 },
] as const satisfies readonly { width: OutputWidth; height: OutputHeight }[];

export const EASINGS = ['linear', 'smoothstep', 'smootherstep'] as const satisfies readonly Easing[];

export const CONFIG_LIMITS = {
  durationSeconds: { min: 1, max: 60, step: 0.1 },
  fontSize: { min: 24, max: 240 },
  position: { min: 0, max: 1 },
} as const;

export const DEFAULT_CONFIG: Readonly<RenderConfig> = Object.freeze({
  startDate: '2026-03-06',
  endDate: '2020-01-01',
  durationSeconds: 10,
  fps: 30,
  width: 1920,
  height: 1080,
  easing: 'smootherstep',
  // New edits start with slashes; a config WITHOUT dateFormat parses as LEGACY_DATE_FORMAT (dots).
  dateFormat: 'YYYY/MM/DD',
  fontFamily: 'bundled-mono',
  fontSize: 96,
  color: '#FFFFFF',
  background: DEFAULT_BACKGROUND,
  x: 0.5,
  y: 0.5,
});
