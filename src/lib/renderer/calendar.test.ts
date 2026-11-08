import { describe, expect, it } from 'vitest';
import {
  dateToOrdinal,
  daysInMonth,
  formatDisplayDate,
  isLeapYear,
  isoToOrdinal,
  isValidIsoDate,
  ordinalToDate,
  ordinalToIso,
  parseIsoDate,
} from './calendar.ts';

describe('calendar', () => {
  it('maps the epoch and known dates to ordinals', () => {
    expect(isoToOrdinal('1970-01-01')).toBe(0);
    expect(isoToOrdinal('1970-01-02')).toBe(1);
    expect(isoToOrdinal('1969-12-31')).toBe(-1);
    expect(isoToOrdinal('2000-03-01') - isoToOrdinal('2000-02-28')).toBe(2); // 2000 is leap
    expect(isoToOrdinal('1900-03-01') - isoToOrdinal('1900-02-28')).toBe(1); // 1900 is not
    expect(isoToOrdinal('2026-03-06') - isoToOrdinal('2020-01-01')).toBe(2256);
  });

  it('agrees with Date.UTC across a wide range', () => {
    for (let y = 1000; y <= 9999; y += 37) {
      for (const [m, d] of [[1, 1], [2, 28], [3, 1], [12, 31]] as const) {
        const expected = Date.UTC(y, m - 1, d) / 86_400_000;
        expect(dateToOrdinal({ year: y, month: m, day: d })).toBe(expected);
      }
    }
  });

  it('round-trips every day from 1899 through 2101', () => {
    const start = isoToOrdinal('1899-01-01');
    const end = isoToOrdinal('2101-12-31');
    let prev = ordinalToDate(start - 1);
    for (let n = start; n <= end; n++) {
      const iso = ordinalToIso(n);
      expect(isValidIsoDate(iso)).toBe(true);
      expect(isoToOrdinal(iso)).toBe(n);
      const cur = ordinalToDate(n);
      // consecutive ordinals are consecutive calendar days
      if (cur.day === 1) {
        expect(prev.day).toBe(daysInMonth(prev.year, prev.month));
      } else {
        expect(cur.day).toBe(prev.day + 1);
      }
      prev = cur;
    }
  });

  it('leap year rules', () => {
    expect(isLeapYear(2020)).toBe(true);
    expect(isLeapYear(2024)).toBe(true);
    expect(isLeapYear(2023)).toBe(false);
    expect(isLeapYear(1900)).toBe(false);
    expect(isLeapYear(2000)).toBe(true);
  });

  it('strictly validates ISO dates', () => {
    expect(parseIsoDate('2020-02-29')).toEqual({ year: 2020, month: 2, day: 29 });
    for (const bad of [
      '2026-02-30',
      '2023-02-29',
      '1900-02-29',
      '2026-04-31',
      '2026-13-01',
      '2026-00-10',
      '2026-01-00',
      '2026-1-01',
      '26-01-01',
      '2026/01/01',
      '2026-01-01T00:00:00Z',
      ' 2026-01-01',
      '0999-12-31',
      '+12026-01-01',
      '',
    ]) {
      expect(isValidIsoDate(bad), bad).toBe(false);
      expect(() => isoToOrdinal(bad)).toThrow(RangeError);
    }
  });

  it('formats display dates as YYYY.MM.DD', () => {
    expect(formatDisplayDate(isoToOrdinal('2026-03-06'))).toBe('2026.03.06');
    expect(formatDisplayDate(isoToOrdinal('1000-01-01'))).toBe('1000.01.01');
    expect(ordinalToIso(isoToOrdinal('9999-12-31'))).toBe('9999-12-31');
  });
});
