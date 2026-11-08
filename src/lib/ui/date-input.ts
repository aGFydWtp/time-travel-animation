// Japanese-order date text (YYYY/MM/DD) <-> ISO `YYYY-MM-DD`, independent of the browser locale.
import { parseIsoDate } from '../renderer/calendar.ts';

/** `2026-03-06` → `2026/03/06`; anything that isn't a valid ISO date is returned unchanged. */
export function isoToDisplay(iso: string): string {
  return parseIsoDate(iso) ? iso.replaceAll('-', '/') : iso;
}

/**
 * Light clean-up while typing: `-` and `.` become `/`, other characters are dropped, and
 * exactly 8 digits typed without separators get slashes (`20260306` → `2026/03/06`).
 */
export function normalizeDateInput(text: string): string {
  const cleaned = text
    .replace(/[-.]/g, '/')
    .replace(/[^\d/]/g, '')
    .slice(0, 10);
  return /^\d{8}$/.test(cleaned) ? `${cleaned.slice(0, 4)}/${cleaned.slice(4, 6)}/${cleaned.slice(6)}` : cleaned;
}

/** `YYYY/M/D` (separators `/`, `-`, `.`; month/day may be 1 digit) or 8 digits → ISO, or null if not a real date. */
export function parseDateInput(text: string): string | null {
  const normalized = normalizeDateInput(text.trim());
  const m = /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/.exec(normalized);
  if (!m) return null;
  const iso = `${m[1]}-${m[2]!.padStart(2, '0')}-${m[3]!.padStart(2, '0')}`;
  return parseIsoDate(iso) ? iso : null;
}
