import { describe, expect, it } from 'vitest';
import { isoToOrdinal } from './calendar.ts';
import { getDateAtFrame, getFrameAtTime, getOrdinalAtFrame, getTotalFrames } from './frames.ts';
import { DEFAULT_CONFIG, EASINGS, type RenderConfig } from './types.ts';

// Spec examples use the acceptance settings (15 s @ 30 fps, dot format). DEFAULT_CONFIG itself is
// 10 s with slashes (see the default and dateFormat tests).
const DOT_CONFIG: RenderConfig = { ...DEFAULT_CONFIG, durationSeconds: 15, dateFormat: 'YYYY.MM.DD' };
const cfg = (overrides: Partial<RenderConfig> = {}): RenderConfig => ({ ...DOT_CONFIG, ...overrides });

/** Every displayed date must parse back as a real calendar date. */
function assertValidDisplay(display: string): number {
  expect(display).toMatch(/^\d{4}\.\d{2}\.\d{2}$/);
  return isoToOrdinal(display.replaceAll('.', '-'));
}

describe('getTotalFrames', () => {
  it('acceptance config (15s @ 30fps) has 450 frames; the default (10s @ 30fps) has 300', () => {
    expect(getTotalFrames(DOT_CONFIG)).toBe(450);
    expect(DEFAULT_CONFIG.durationSeconds).toBe(10);
    expect(getTotalFrames(DEFAULT_CONFIG)).toBe(300);
  });

  it('handles 0.1s-step durations without float drift', () => {
    expect(getTotalFrames({ fps: 24, durationSeconds: 2.0 })).toBe(48);
    expect(getTotalFrames({ fps: 60, durationSeconds: 60 })).toBe(3600);
    for (const fps of [24, 30, 60] as const) {
      for (let k = 10; k <= 600; k++) {
        const durationSeconds = k / 10;
        expect(getTotalFrames({ fps, durationSeconds })).toBe(Math.round((fps * k) / 10));
      }
    }
    // values produced by float accumulation, e.g. 0.1 * 3 = 0.30000000000000004
    expect(getTotalFrames({ fps: 30, durationSeconds: 1.1 + 0.2 })).toBe(39);
    expect(getTotalFrames({ fps: 24, durationSeconds: 0.7 * 3 })).toBe(50);
  });
});

describe('getDateAtFrame', () => {
  it('default config: frame 0 = 2026.03.06, frame 449 = 2020.01.01', () => {
    expect(getDateAtFrame(0, DOT_CONFIG)).toBe('2026.03.06');
    expect(getDateAtFrame(449, DOT_CONFIG)).toBe('2020.01.01');
  });

  it('clamps out-of-range frame indices', () => {
    expect(getDateAtFrame(-10, DOT_CONFIG)).toBe('2026.03.06');
    expect(getDateAtFrame(450, DOT_CONFIG)).toBe('2020.01.01');
    expect(getDateAtFrame(1e9, DOT_CONFIG)).toBe('2020.01.01');
    expect(getDateAtFrame(Number.NaN, DOT_CONFIG)).toBe('2026.03.06');
  });

  it.each(EASINGS)('forward / backward / same-day with %s', (easing) => {
    const forward = cfg({ startDate: '2020-01-01', endDate: '2026-03-06', easing });
    expect(getDateAtFrame(0, forward)).toBe('2020.01.01');
    expect(getDateAtFrame(449, forward)).toBe('2026.03.06');

    const backward = cfg({ easing });
    expect(getDateAtFrame(0, backward)).toBe('2026.03.06');
    expect(getDateAtFrame(449, backward)).toBe('2020.01.01');

    const same = cfg({ startDate: '2024-02-29', endDate: '2024-02-29', easing });
    for (let i = 0; i < getTotalFrames(same); i++) {
      expect(getDateAtFrame(i, same)).toBe('2024.02.29');
    }
  });

  it('easings differ in the middle but agree at the ends', () => {
    const mid = (easing: RenderConfig['easing']) => getOrdinalAtFrame(100, cfg({ easing }));
    expect(new Set(EASINGS.map(mid)).size).toBe(3);
    // smootherstep starts slowest
    expect(getOrdinalAtFrame(20, cfg({ easing: 'smootherstep' }))).toBeGreaterThan(
      getOrdinalAtFrame(20, cfg({ easing: 'linear' })),
    );
  });

  it('linear midpoint follows the formula', () => {
    const c = cfg({ easing: 'linear' });
    const start = isoToOrdinal(c.startDate);
    const end = isoToOrdinal(c.endDate);
    for (const i of [1, 100, 224, 225, 300, 448]) {
      expect(getOrdinalAtFrame(i, c)).toBe(Math.round(start + ((end - start) * i) / 449));
    }
  });

  it('passes through leap days, month ends and year ends with every output valid', () => {
    // 60s @ 60fps linear over ~1857 days: step < 1 day, so every calendar day appears.
    const c = cfg({
      startDate: '2019-12-01',
      endDate: '2024-12-31',
      durationSeconds: 60,
      fps: 60,
      easing: 'linear',
    });
    const seen = new Set<string>();
    for (let i = 0; i < getTotalFrames(c); i++) {
      const d = getDateAtFrame(i, c);
      assertValidDisplay(d);
      seen.add(d);
    }
    const days = isoToOrdinal(c.endDate) - isoToOrdinal(c.startDate) + 1;
    expect(seen.size).toBe(days);
    for (const d of ['2020.02.29', '2024.02.29', '2019.12.31', '2020.01.01', '2023.02.28', '2023.03.01', '2024.12.31']) {
      expect(seen.has(d), d).toBe(true);
    }
    expect(seen.has('2023.02.29')).toBe(false);
  });

  const monotonicCases: Array<[string, Partial<RenderConfig>]> = [
    ['default countdown', {}],
    ['countdown 60fps 60s', { fps: 60, durationSeconds: 60 }],
    ['count-up 60fps 60s', { startDate: '2020-01-01', endDate: '2026-03-06', fps: 60, durationSeconds: 60 }],
    ['count-up 24fps 2s', { startDate: '2020-01-01', endDate: '2026-03-06', fps: 24, durationSeconds: 2 }],
    ['long countdown 24fps 1s', { startDate: '9999-12-31', endDate: '1000-01-01', fps: 24, durationSeconds: 1 }],
    ['short count-up 30fps 12.3s', { startDate: '2024-02-27', endDate: '2024-03-02', durationSeconds: 12.3 }],
  ];

  for (const [name, overrides] of monotonicCases) {
    it.each(EASINGS)(`is monotonic and always valid: ${name} / %s`, (easing) => {
      const c = cfg({ ...overrides, easing });
      const n = getTotalFrames(c);
      const direction = Math.sign(isoToOrdinal(c.endDate) - isoToOrdinal(c.startDate));
      let prev = getOrdinalAtFrame(0, c);
      expect(prev).toBe(isoToOrdinal(c.startDate));
      for (let i = 1; i < n; i++) {
        const cur = getOrdinalAtFrame(i, c);
        if (direction < 0) expect(cur).toBeLessThanOrEqual(prev);
        else expect(cur).toBeGreaterThanOrEqual(prev);
        expect(assertValidDisplay(getDateAtFrame(i, c))).toBe(cur);
        prev = cur;
      }
      expect(prev).toBe(isoToOrdinal(c.endDate));
    });
  }
});

describe('getDateAtFrame dateFormat', () => {
  it('DEFAULT_CONFIG renders slashes', () => {
    expect(DEFAULT_CONFIG.dateFormat).toBe('YYYY/MM/DD');
    expect(getDateAtFrame(0, DEFAULT_CONFIG)).toBe('2026/03/06');
    expect(getDateAtFrame(299, DEFAULT_CONFIG)).toBe('2020/01/01');
  });

  it.each([
    ['YYYY.MM.DD', '2026.03.06', '2020.01.01'],
    ['YYYY/MM/DD', '2026/03/06', '2020/01/01'],
    ['YYYY年MM月DD日', '2026年03月06日', '2020年01月01日'],
  ] as const)('honours %s', (dateFormat, first, last) => {
    const c = cfg({ dateFormat });
    expect(getDateAtFrame(0, c)).toBe(first);
    expect(getDateAtFrame(getTotalFrames(c) - 1, c)).toBe(last);
  });

  it('same ordinal sequence in every format (only the formatting differs)', () => {
    const c = cfg({ startDate: '2024-02-27', endDate: '2024-03-02', durationSeconds: 1 });
    for (let i = 0; i < getTotalFrames(c); i++) {
      const dot = getDateAtFrame(i, c);
      expect(getDateAtFrame(i, { ...c, dateFormat: 'YYYY/MM/DD' })).toBe(dot.replaceAll('.', '/'));
      const [y, m, d] = dot.split('.');
      expect(getDateAtFrame(i, { ...c, dateFormat: 'YYYY年MM月DD日' })).toBe(`${y}年${m}月${d}日`);
    }
  });
});

describe('getFrameAtTime', () => {
  it('maps time to frame index and clamps', () => {
    expect(getFrameAtTime(0, DEFAULT_CONFIG)).toBe(0);
    expect(getFrameAtTime(1, DEFAULT_CONFIG)).toBe(30);
    expect(getFrameAtTime(0.1 * 3, DEFAULT_CONFIG)).toBe(9);
    expect(getFrameAtTime(10, DEFAULT_CONFIG)).toBe(299);
    expect(getFrameAtTime(15, DOT_CONFIG)).toBe(449);
    expect(getFrameAtTime(-1, DEFAULT_CONFIG)).toBe(0);
  });
});
