import { formatDisplayDate, isoToOrdinal } from './calendar.ts';
import { ease } from './easing.ts';
import type { RenderConfig } from './types.ts';

type FrameTimingConfig = Pick<RenderConfig, 'fps' | 'durationSeconds'>;
type FrameDateConfig = Pick<RenderConfig, 'fps' | 'durationSeconds' | 'startDate' | 'endDate' | 'easing'>;

/**
 * N = round(fps * durationSeconds), at least 1.
 * With fps in {24,30,60} and 0.1s steps, fps*duration never sits on a .5
 * boundary, so plain Math.round is exact despite float representation.
 */
export function getTotalFrames(config: FrameTimingConfig): number {
  const n = Math.round(config.fps * config.durationSeconds);
  return Number.isFinite(n) && n >= 1 ? n : 1;
}

/** Clamp an arbitrary frame index into [0, N-1] (non-integers truncated, NaN -> 0). */
export function clampFrameIndex(frameIndex: number, totalFrames: number): number {
  const i = Number.isFinite(frameIndex) ? Math.trunc(frameIndex) : 0;
  return Math.min(Math.max(i, 0), totalFrames - 1);
}

/** Calendar-day ordinal shown at the given frame (spec §5.1). */
export function getOrdinalAtFrame(frameIndex: number, config: FrameDateConfig): number {
  const startDay = isoToOrdinal(config.startDate);
  const endDay = isoToOrdinal(config.endDate);
  const n = getTotalFrames(config);
  const i = clampFrameIndex(frameIndex, n);
  if (i === n - 1) return endDay; // last frame is always exactly the end date
  const t = n > 1 ? i / (n - 1) : 1;
  const p = ease(config.easing, t);
  return Math.round(startDay + (endDay - startDay) * p);
}

/** Display string `YYYY.MM.DD` shown at the given frame. */
export function getDateAtFrame(frameIndex: number, config: FrameDateConfig): string {
  return formatDisplayDate(getOrdinalAtFrame(frameIndex, config));
}

/** Frame index for a playback time in seconds (preview seek / playback). */
export function getFrameAtTime(seconds: number, config: FrameTimingConfig): number {
  const n = getTotalFrames(config);
  return clampFrameIndex(Math.floor(seconds * config.fps + 1e-9), n);
}
