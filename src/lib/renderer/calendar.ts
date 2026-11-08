/**
 * Calendar-day arithmetic on the proleptic Gregorian calendar.
 *
 * Dates are timezone-less calendar days represented as an integer "ordinal"
 * (days since 1970-01-01, which is ordinal 0). Pure integer arithmetic only:
 * no `Date`, no local timezone.
 *
 * Algorithm: Howard Hinnant's days_from_civil / civil_from_days.
 */

import type { DateFormat } from './types.ts';

export const MIN_YEAR = 1000;
export const MAX_YEAR = 9999;

export interface CalendarDate {
  year: number;
  month: number; // 1..12
  day: number; // 1..31
}

const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

export function daysInMonth(year: number, month: number): number {
  switch (month) {
    case 2:
      return isLeapYear(year) ? 29 : 28;
    case 4:
    case 6:
    case 9:
    case 11:
      return 30;
    default:
      return 31;
  }
}

function isValidParts(year: number, month: number, day: number): boolean {
  return (
    Number.isInteger(year) &&
    Number.isInteger(month) &&
    Number.isInteger(day) &&
    year >= MIN_YEAR &&
    year <= MAX_YEAR &&
    month >= 1 &&
    month <= 12 &&
    day >= 1 &&
    day <= daysInMonth(year, month)
  );
}

/** Strictly parse `YYYY-MM-DD`. Returns null for malformed or non-existent dates. */
export function parseIsoDate(value: string): CalendarDate | null {
  if (typeof value !== 'string') return null;
  const m = ISO_DATE_RE.exec(value);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  return isValidParts(year, month, day) ? { year, month, day } : null;
}

export function isValidIsoDate(value: string): boolean {
  return parseIsoDate(value) !== null;
}

/** Calendar date -> ordinal (days since 1970-01-01). */
export function dateToOrdinal({ year, month, day }: CalendarDate): number {
  const y = month <= 2 ? year - 1 : year;
  const era = Math.floor(y / 400);
  const yoe = y - era * 400; // [0, 399]
  const mp = month > 2 ? month - 3 : month + 9; // March-based month [0, 11]
  const doy = Math.floor((153 * mp + 2) / 5) + day - 1; // [0, 365]
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy; // [0, 146096]
  return era * 146097 + doe - 719468;
}

/** Ordinal (days since 1970-01-01) -> calendar date. */
export function ordinalToDate(ordinal: number): CalendarDate {
  if (!Number.isInteger(ordinal)) {
    throw new RangeError(`Ordinal must be an integer: ${ordinal}`);
  }
  const z = ordinal + 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097; // [0, 146096]
  const yoe = Math.floor(
    (doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365,
  ); // [0, 399]
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100)); // [0, 365]
  const mp = Math.floor((5 * doy + 2) / 153); // [0, 11]
  const day = doy - Math.floor((153 * mp + 2) / 5) + 1; // [1, 31]
  const month = mp < 10 ? mp + 3 : mp - 9; // [1, 12]
  const year = yoe + era * 400 + (month <= 2 ? 1 : 0);
  return { year, month, day };
}

/** `YYYY-MM-DD` -> ordinal. Throws RangeError on invalid input. */
export function isoToOrdinal(value: string): number {
  const parts = parseIsoDate(value);
  if (!parts) throw new RangeError(`Invalid ISO date: ${value}`);
  return dateToOrdinal(parts);
}

function pad(n: number, width: number): string {
  return String(n).padStart(width, '0');
}

function formatWith(ordinal: number, sep: string): string {
  const { year, month, day } = ordinalToDate(ordinal);
  return `${pad(year, 4)}${sep}${pad(month, 2)}${sep}${pad(day, 2)}`;
}

/** Ordinal -> `YYYY-MM-DD`. */
export function ordinalToIso(ordinal: number): string {
  return formatWith(ordinal, '-');
}

/** Ordinal -> display string in the given format (default `YYYY.MM.DD`). */
export function formatDisplayDate(ordinal: number, format: DateFormat = 'YYYY.MM.DD'): string {
  switch (format) {
    case 'YYYY.MM.DD':
      return formatWith(ordinal, '.');
    case 'YYYY/MM/DD':
      return formatWith(ordinal, '/');
    case 'YYYY年MM月DD日': {
      const { year, month, day } = ordinalToDate(ordinal);
      return `${pad(year, 4)}年${pad(month, 2)}月${pad(day, 2)}日`;
    }
    default:
      throw new RangeError(`Unknown date format: ${String(format satisfies never)}`);
  }
}
