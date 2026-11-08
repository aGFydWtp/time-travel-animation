// Display formatting for the job list.
import type { JobStage, JobStatus } from '../api/types.ts';
import { formatDisplayDate, isoToOrdinal } from '../renderer/calendar.ts';
import { FONTS, isFontId } from '../renderer/fonts.ts';
import type { RenderConfig } from '../renderer/types.ts';

function displayDate(iso: string): string {
  try {
    return formatDisplayDate(isoToOrdinal(iso));
  } catch {
    return iso;
  }
}

/** One-line config summary, e.g. `2026.03.06 → 2020.01.01 · 15秒 · 30fps · 1920×1080 · smootherstep`. */
export function summarizeConfig(config: RenderConfig): string {
  return [
    `${displayDate(config.startDate)} → ${displayDate(config.endDate)}`,
    `${config.durationSeconds}秒`,
    `${config.fps}fps`,
    `${config.width}×${config.height}`,
    config.easing,
  ].join(' · ');
}

/** Secondary details: font, size, colour, position. */
export function summarizeStyle(config: RenderConfig): string {
  const font = isFontId(config.fontFamily) ? FONTS[config.fontFamily].label : config.fontFamily;
  return [
    font,
    `${config.fontSize}px`,
    config.color.toUpperCase(),
    `位置 ${config.x.toFixed(2)}, ${config.y.toFixed(2)}`,
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
