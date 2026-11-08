export type Fps = 24 | 30 | 60;
export type OutputWidth = 1280 | 1920;
export type OutputHeight = 720 | 1080;
export type Easing = 'linear' | 'smoothstep' | 'smootherstep';

export interface RenderConfig {
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  durationSeconds: number;
  fps: Fps;
  width: OutputWidth;
  height: OutputHeight;
  easing: Easing;
  fontFamily: string; // bundled font identifier (key of FONTS)
  fontSize: number; // output pixels
  color: string; // #RRGGBB
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
  durationSeconds: 15,
  fps: 30,
  width: 1920,
  height: 1080,
  easing: 'smootherstep',
  fontFamily: 'bundled-mono',
  fontSize: 96,
  color: '#FFFFFF',
  x: 0.5,
  y: 0.5,
});
