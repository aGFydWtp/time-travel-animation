// Editor form state <-> RenderConfig, and mapping of validation issues to fields.
import { BACKGROUND_PRESETS, DEFAULT_BACKGROUND, DEFAULT_CONFIG, RESOLUTIONS, type RenderConfig } from '../renderer/types.ts';

export type ResolutionKey = `${number}x${number}`;

/** Raw values bound to the inputs. Number inputs yield null while empty. */
export interface EditorForm {
  startDate: string;
  endDate: string;
  durationSeconds: number | null;
  fps: number;
  resolution: ResolutionKey;
  easing: string;
  dateFormat: string;
  fontFamily: string;
  fontSize: number | null;
  color: string;
  /** 'transparent' or a #RRGGBB being typed (presets are just their hex). */
  background: string;
  x: number;
  y: number;
}

export type FormField = keyof EditorForm;

export const RESOLUTION_OPTIONS = RESOLUTIONS.map((r) => ({
  key: `${r.width}x${r.height}` as ResolutionKey,
  label: `${r.width}×${r.height}`,
}));

export function formFromConfig(config: Readonly<RenderConfig>): EditorForm {
  return {
    startDate: config.startDate,
    endDate: config.endDate,
    durationSeconds: config.durationSeconds,
    fps: config.fps,
    resolution: `${config.width}x${config.height}`,
    easing: config.easing,
    dateFormat: config.dateFormat,
    fontFamily: config.fontFamily,
    fontSize: config.fontSize,
    color: config.color,
    background: config.background ?? DEFAULT_BACKGROUND,
    x: config.x,
    y: config.y,
  };
}

export function defaultForm(): EditorForm {
  return formFromConfig(DEFAULT_CONFIG);
}

/** Build the unvalidated config object handed to safeParseRenderConfig. */
export function formToConfigInput(form: EditorForm): Record<string, unknown> {
  const [w, h] = form.resolution.split('x').map(Number);
  return {
    startDate: form.startDate,
    endDate: form.endDate,
    durationSeconds: form.durationSeconds ?? Number.NaN,
    fps: Number(form.fps),
    width: w,
    height: h,
    easing: form.easing,
    dateFormat: form.dateFormat,
    fontFamily: form.fontFamily,
    fontSize: form.fontSize ?? Number.NaN,
    color: form.color.trim(),
    background: form.background.trim(),
    x: Number(form.x),
    y: Number(form.y),
  };
}

/** Japanese inline messages per field (Zod messages are developer-facing English). */
export const FIELD_MESSAGES: Record<FormField, string> = {
  startDate: '1000/01/01〜9999/12/31 の実在する日付を YYYY/MM/DD で入力してください',
  endDate: '1000/01/01〜9999/12/31 の実在する日付を YYYY/MM/DD で入力してください',
  durationSeconds: '1〜60 秒の範囲で、0.1 秒刻みで入力してください',
  fps: '24 / 30 / 60 から選んでください',
  resolution: '1280×720 または 1920×1080 を選んでください',
  easing: '速度曲線を選んでください',
  dateFormat: '日付の表示形式を選んでください',
  fontFamily: '同梱フォントから選んでください',
  fontSize: '24〜240 の整数で入力してください',
  color: '#RRGGBB 形式（例: #FFFFFF）で入力してください',
  background: '#RRGGBB 形式（例: #00FF00）で入力してください',
  x: '0〜1 の範囲で指定してください',
  y: '0〜1 の範囲で指定してください',
};

const CONFIG_KEY_TO_FIELD: Record<string, FormField> = {
  width: 'resolution',
  height: 'resolution',
};

/** Map validation issues (Zod `path`) to one message per form field. */
export function fieldErrors(
  issues: readonly { path: readonly PropertyKey[] }[] | undefined,
): Partial<Record<FormField, string>> {
  const errors: Partial<Record<FormField, string>> = {};
  for (const issue of issues ?? []) {
    const key = issue.path[0];
    if (typeof key !== 'string') continue;
    const field = (CONFIG_KEY_TO_FIELD[key] ?? key) as FormField;
    if (field in FIELD_MESSAGES && !errors[field]) errors[field] = FIELD_MESSAGES[field];
  }
  return errors;
}

/** Normalize a hex colour typed by the user: adds `#`, uppercases. Returns null if not #RRGGBB. */
export function normalizeHex(value: string): string | null {
  const v = value.trim();
  const withHash = v.startsWith('#') ? v : `#${v}`;
  return /^#[0-9A-Fa-f]{6}$/.test(withHash) ? withHash.toUpperCase() : null;
}

// ---- 背景 ---------------------------------------------------------------

export type BackgroundChoice = 'transparent' | (typeof BACKGROUND_PRESETS)[number]['key'] | 'custom';

/** The five choices of the 背景 control, in display order. */
export const BACKGROUND_CHOICES: readonly { value: BackgroundChoice; label: string }[] = [
  { value: 'transparent', label: '透過（MOV）' },
  ...BACKGROUND_PRESETS.map((p) => ({ value: p.key, label: p.label })),
  { value: 'custom', label: '好きな色' },
];

/** Starting colour for 好きな色 until the user picks one (not a preset, so the choice stays 好きな色). */
export const DEFAULT_CUSTOM_BACKGROUND = '#0000FF';

/**
 * Which choice a background value shows: a complete `#RRGGBB` equal to a preset selects that preset;
 * anything else (other colours, or text still being typed, e.g. `00ff00` without `#`) is 好きな色, so the
 * hex field stays mounted until its blur normalizes the value.
 */
export function backgroundChoice(value: string): BackgroundChoice {
  if (value === 'transparent') return 'transparent';
  if (!/^#[0-9A-Fa-f]{6}$/.test(value)) return 'custom';
  const hex = value.toUpperCase();
  return BACKGROUND_PRESETS.find((p) => p.hex === hex)?.key ?? 'custom';
}

/** The value a choice sets; 好きな色 restores the last custom colour. */
export function backgroundValue(choice: BackgroundChoice, lastCustom: string): string {
  if (choice === 'transparent') return 'transparent';
  if (choice === 'custom') return lastCustom;
  return BACKGROUND_PRESETS.find((p) => p.key === choice)?.hex ?? lastCustom;
}
