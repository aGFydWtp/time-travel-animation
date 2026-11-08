import { describe, expect, it } from 'vitest';
import { getDateAtFrame } from '../renderer/frames.ts';
import { DEFAULT_CONFIG } from '../renderer/types.ts';
import { PlaybackClock, formatTime, frameToSeconds, playbackStep } from './playback.ts';

function fakeNow(start = 1000) {
  let t = start;
  return {
    now: () => t,
    advance: (ms: number) => {
      t += ms;
    },
  };
}

describe('PlaybackClock', () => {
  it('accumulates only while playing', () => {
    const time = fakeNow();
    const clock = new PlaybackClock(time.now);
    time.advance(500);
    expect(clock.elapsed()).toBe(0);
    clock.play();
    time.advance(1500);
    expect(clock.elapsed()).toBeCloseTo(1.5);
    clock.pause();
    time.advance(5000);
    expect(clock.elapsed()).toBeCloseTo(1.5);
    expect(clock.playing).toBe(false);
  });

  it('seek keeps playing state and restarts the reference point', () => {
    const time = fakeNow();
    const clock = new PlaybackClock(time.now);
    clock.play();
    time.advance(2000);
    clock.seek(10);
    expect(clock.elapsed()).toBe(10);
    time.advance(250);
    expect(clock.elapsed()).toBeCloseTo(10.25);
    expect(clock.playing).toBe(true);
  });

  it('clamps negative/NaN seeks to 0 and ignores double play/pause', () => {
    const time = fakeNow();
    const clock = new PlaybackClock(time.now);
    clock.seek(-3);
    expect(clock.elapsed()).toBe(0);
    clock.seek(Number.NaN);
    expect(clock.elapsed()).toBe(0);
    clock.play();
    time.advance(1000);
    clock.play(); // must not reset the reference point
    expect(clock.elapsed()).toBeCloseTo(1);
    clock.pause();
    clock.pause();
    expect(clock.elapsed()).toBeCloseTo(1);
  });
});

describe('playbackStep', () => {
  const cfg = { fps: 30 as const, durationSeconds: 15 };

  it('is time-based: skipping rAF ticks lands on the same frame', () => {
    // 2.5s at 30fps is frame 75 regardless of how many ticks happened before.
    expect(playbackStep(2.5, cfg)).toEqual({ frame: 75, ended: false });
  });

  it('starts at frame 0 and ends on the last frame after its slot', () => {
    expect(playbackStep(0, cfg)).toEqual({ frame: 0, ended: false });
    expect(playbackStep(449 / 30, cfg)).toEqual({ frame: 449, ended: false });
    expect(playbackStep(15, cfg)).toEqual({ frame: 449, ended: true });
    expect(playbackStep(99, cfg)).toEqual({ frame: 449, ended: true });
  });

  it('0% shows the start date and the end shows the end date', () => {
    const first = playbackStep(0, DEFAULT_CONFIG).frame;
    const last = playbackStep(DEFAULT_CONFIG.durationSeconds, DEFAULT_CONFIG).frame;
    expect(getDateAtFrame(first, DEFAULT_CONFIG)).toBe('2026/03/06');
    expect(getDateAtFrame(last, DEFAULT_CONFIG)).toBe('2020/01/01');
  });

  it('frameToSeconds round-trips through the frame mapping', () => {
    for (const frame of [0, 1, 29, 30, 224, 449]) {
      expect(playbackStep(frameToSeconds(frame, cfg), cfg).frame).toBe(frame);
    }
  });
});

describe('formatTime', () => {
  it('formats MM:SS.cc', () => {
    expect(formatTime(0)).toBe('00:00.00');
    expect(formatTime(14.966666)).toBe('00:14.97');
    expect(formatTime(60)).toBe('01:00.00');
    expect(formatTime(75.5)).toBe('01:15.50');
  });

  it('treats invalid input as zero', () => {
    expect(formatTime(Number.NaN)).toBe('00:00.00');
    expect(formatTime(-2)).toBe('00:00.00');
  });
});
