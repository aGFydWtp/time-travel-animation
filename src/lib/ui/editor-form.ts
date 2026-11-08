// Editor form state <-> RenderConfig, and mapping of validation issues to fields.
import { DEFAULT_CONFIG, RESOLUTIONS, type RenderConfig } from '../renderer/types.ts';

export type ResolutionKey = `${number}x${number}`;

/** Raw values bound to the inputs. Number inputs yield null while empty. */
export interface EditorForm {
  startDate: string;
  endDate: string;
  durationSeconds: number | null;
  fps: number;
  resolution: ResolutionKey;
  easing: string;
  fontFamily: string;
  fontSize: number | null;
  color: string;
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
    fontFamily: config.fontFamily,
    fontSize: config.fontSize,
    color: config.color,
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
    fontFamily: form.fontFamily,
    fontSize: form.fontSize ?? Number.NaN,
    color: form.color.trim(),
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
  fontFamily: '同梱フォントから選んでください',
  fontSize: '24〜240 の整数で入力してください',
  color: '#RRGGBB 形式（例: #FFFFFF）で入力してください',
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
