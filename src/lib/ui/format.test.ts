import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '../renderer/types.ts';
import {
  clampProgress,
  formatBytes,
  formatShortTimestamp,
  formatTimestamp,
  summarizeOutput,
  summarizeRange,
  summarizeStyle,
} from './format.ts';

describe('summarizeRange / summarizeOutput', () => {
  it('summarizes the default config', () => {
    expect(summarizeRange(DEFAULT_CONFIG)).toBe('2026.03.06 → 2020.01.01 · 15秒');
    expect(summarizeOutput(DEFAULT_CONFIG)).toBe('1920×1080 · 30fps · smootherstep');
  });

  it('keeps tenth-second durations', () => {
    expect(summarizeRange({ ...DEFAULT_CONFIG, durationSeconds: 2.5 })).toContain('· 2.5秒');
    expect(summarizeOutput({ ...DEFAULT_CONFIG, fps: 24, width: 1280, height: 720 })).toBe('1280×720 · 24fps · smootherstep');
  });
});

describe('formatShortTimestamp', () => {
  const now = new Date('2026-11-08T12:00:00.000Z');
  it('drops the year within the current year', () => {
    expect(formatShortTimestamp('2026-11-08T15:04:00.000Z', now, 'UTC')).toBe('11/08 15:04');
  });

  it('shows only the date for other years and passes through bad input', () => {
    expect(formatShortTimestamp('2025-02-01T15:04:00.000Z', now, 'UTC')).toBe('2025/02/01');
    expect(formatShortTimestamp('nope', now, 'UTC')).toBe('nope');
  });
});

describe('summarizeStyle', () => {
  it('shows font label, size, colour and position', () => {
    expect(summarizeStyle(DEFAULT_CONFIG)).toBe('JetBrains Mono · 96px · #FFFFFF · 位置 0.50, 0.50');
  });
});

describe('formatTimestamp', () => {
  it('formats in the requested time zone', () => {
    expect(formatTimestamp('2026-11-08T15:04:00.000Z', 'UTC')).toBe('2026/11/08 15:04');
    expect(formatTimestamp('2026-11-08T15:04:00.000Z', 'Asia/Tokyo')).toBe('2026/11/09 00:04');
  });

  it('returns the input for unparsable values', () => {
    expect(formatTimestamp('nope')).toBe('nope');
  });
});

describe('formatBytes', () => {
  it('uses binary units', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(250 * 1024 * 1024)).toBe('250 MB');
    expect(formatBytes(-1)).toBe('—');
  });
});

describe('clampProgress', () => {
  it('clamps to 0..100 integers', () => {
    expect(clampProgress(-5)).toBe(0);
    expect(clampProgress(42.6)).toBe(43);
    expect(clampProgress(150)).toBe(100);
    expect(clampProgress(Number.NaN)).toBe(0);
  });
});
