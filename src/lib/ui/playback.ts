// Time-based playback for the Canvas preview (spec §4.1).
// The frame shown is always derived from elapsed wall-clock time, never from a
// count of rAF callbacks, so dropped animation frames cannot desync the preview.
import { getFrameAtTime, getTotalFrames } from '../renderer/frames.ts';
import type { RenderConfig } from '../renderer/types.ts';

type TimingConfig = Pick<RenderConfig, 'fps' | 'durationSeconds'>;

/**
 * Play/pause/seek clock. `now` returns milliseconds (performance.now in the
 * browser); it is injected so the clock is deterministic under test.
 */
export class PlaybackClock {
  #baseSeconds = 0;
  #startedAtMs: number | null = null;
  readonly #now: () => number;

  constructor(now: () => number) {
    this.#now = now;
  }

  get playing(): boolean {
    return this.#startedAtMs !== null;
  }

  /** Elapsed playback time in seconds. */
  elapsed(): number {
    if (this.#startedAtMs === null) return this.#baseSeconds;
    return this.#baseSeconds + (this.#now() - this.#startedAtMs) / 1000;
  }

  play(): void {
    if (this.#startedAtMs !== null) return;
    this.#startedAtMs = this.#now();
  }

  pause(): void {
    if (this.#startedAtMs === null) return;
    this.#baseSeconds = this.elapsed();
    this.#startedAtMs = null;
  }

  /** Jump to a time; keeps playing if it was playing. */
  seek(seconds: number): void {
    this.#baseSeconds = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
    if (this.#startedAtMs !== null) this.#startedAtMs = this.#now();
  }
}

export interface PlaybackStep {
  frame: number;
  /** True once the last frame has been on screen for its full 1/fps slot. */
  ended: boolean;
}

/** Map elapsed seconds to the frame to show and whether playback has finished. */
export function playbackStep(elapsedSeconds: number, config: TimingConfig): PlaybackStep {
  const total = getTotalFrames(config);
  const ended = elapsedSeconds >= total / config.fps;
  return {
    frame: ended ? total - 1 : getFrameAtTime(elapsedSeconds, config),
    ended,
  };
}

/** Start time (seconds) of a frame — used to seek the clock to a frame. */
export function frameToSeconds(frame: number, config: Pick<RenderConfig, 'fps'>): number {
  return frame / config.fps;
}

/** `MM:SS.cc` (centiseconds), e.g. 75.5 -> `01:15.50`. */
export function formatTime(seconds: number): string {
  const totalCs = Math.max(0, Math.round((Number.isFinite(seconds) ? seconds : 0) * 100));
  const minutes = Math.floor(totalCs / 6000);
  const secs = Math.floor((totalCs % 6000) / 100);
  const cs = totalCs % 100;
  return `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}
