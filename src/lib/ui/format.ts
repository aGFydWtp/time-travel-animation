// Display formatting for the job list.
import type { JobStage, JobStatus } from '../api/types.ts';
import { formatDisplayDate, isoToOrdinal } from '../renderer/calendar.ts';
import { FONTS, isFontId } from '../renderer/fonts.ts';
import {
  BACKGROUND_PRESETS,
  DEFAULT_BACKGROUND,
  LEGACY_DATE_FORMAT,
  type DateFormat,
  type Easing,
  type RenderConfig,
} from '../renderer/types.ts';

/** 速度曲線 labels, used by the select and every summary. */
export const EASING_LABELS: Record<Easing, string> = {
  linear: '一定',
  smoothstep: 'なめらか',
  smootherstep: 'よりなめらか',
};

function displayDate(iso: string, format: DateFormat): string {
  try {
    return formatDisplayDate(isoToOrdinal(iso), format);
  } catch {
    return iso;
  }
}

/**
 * The job's identity in the history list, in the job's own date format,
 * e.g. `2026/03/06 → 2020/01/01 · 15秒`. Old jobs without a format were rendered with dots.
 */
export function summarizeRange(config: RenderConfig): string {
  const format = config.dateFormat ?? LEGACY_DATE_FORMAT;
  return `${displayDate(config.startDate, format)} → ${displayDate(config.endDate, format)} · ${config.durationSeconds}秒`;
}

/** Output settings, e.g. `1920×1080 · 30fps · よりなめらか`. */
export function summarizeOutput(config: RenderConfig): string {
  return [`${config.width}×${config.height}`, `${config.fps}fps`, EASING_LABELS[config.easing] ?? config.easing].join(
    ' · ',
  );
}

/** 背景 label: 透過 / 黒 / 白 / グリーン / #RRGGBB. Jobs from before the option were transparent. */
export function backgroundLabel(background: string | undefined): string {
  const bg = background ?? DEFAULT_BACKGROUND;
  if (bg === 'transparent') return '透過';
  const hex = bg.toUpperCase();
  return BACKGROUND_PRESETS.find((p) => p.hex === hex)?.label ?? hex;
}

/** Secondary details: font, size, colour, position, background. */
export function summarizeStyle(config: RenderConfig): string {
  const font = isFontId(config.fontFamily) ? FONTS[config.fontFamily].label : config.fontFamily;
  return [
    font,
    `${config.fontSize}px`,
    config.color.toUpperCase(),
    `位置 ${config.x.toFixed(2)}, ${config.y.toFixed(2)}`,
    `背景 ${backgroundLabel(config.background)}`,
  ].join(' · ');
}

/** `YYYY/MM/DD HH:mm` in the given (default: browser) time zone. */
export function formatTimestamp(iso: string, timeZone?: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}/${get('month')}/${get('day')} ${get('hour')}:${get('minute')}`;
}

/** Compact time for list rows: `MM/DD HH:mm`, or `YYYY/MM/DD` outside the current year. */
export function formatShortTimestamp(iso: string, now: Date = new Date(), timeZone?: string): string {
  const full = formatTimestamp(iso, timeZone);
  if (full === iso) return iso;
  const [day = '', time = ''] = full.split(' ');
  const [year, month, date] = day.split('/');
  const currentYear = formatTimestamp(now.toISOString(), timeZone).slice(0, 4);
  return year === currentYear ? `${month}/${date} ${time}` : day;
}

/** Human-readable byte size (binary units). */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return unit === 0 ? `${value} ${units[unit]}` : `${value.toFixed(value >= 100 ? 0 : 1)} ${units[unit]}`;
}

export const STATUS_LABELS: Record<JobStatus, string> = {
  queued: '待機中',
  running: '処理中',
  completed: '完了',
  failed: '失敗',
};

export const STAGE_LABELS: Record<JobStage, string> = {
  queued: '順番待ち',
  starting: '起動中',
  rendering_frames: 'フレーム描画中',
  encoding: 'エンコード中',
  uploading: 'アップロード中',
  validating: '検証中',
  done: '完了',
};

export function clampProgress(progress: number): number {
  if (!Number.isFinite(progress)) return 0;
  return Math.min(100, Math.max(0, Math.round(progress)));
}
