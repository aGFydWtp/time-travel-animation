import { describe, expect, it } from 'vitest';
import { isoToDisplay, normalizeDateInput, parseDateInput } from './date-input.ts';

describe('isoToDisplay', () => {
  it('shows ISO dates in YYYY/MM/DD order', () => {
    expect(isoToDisplay('2026-03-06')).toBe('2026/03/06');
  });

  it('leaves invalid or partial text alone', () => {
    expect(isoToDisplay('2026/13/01')).toBe('2026/13/01');
    expect(isoToDisplay('')).toBe('');
  });
});

describe('normalizeDateInput', () => {
  it('turns - and . into / and drops other characters', () => {
    expect(normalizeDateInput('2026-03-06')).toBe('2026/03/06');
    expect(normalizeDateInput('2026.3.6')).toBe('2026/3/6');
    expect(normalizeDateInput('2026年03月06日')).toBe('2026/03/06');
  });

  it('converts full-width input from an IME or paste', () => {
    expect(normalizeDateInput('２０２６／０３／０６')).toBe('2026/03/06');
    expect(normalizeDateInput('２０２６０３０６')).toBe('2026/03/06');
    expect(normalizeDateInput('2026年3月6日')).toBe('2026/3/6');
    expect(parseDateInput('２０２０－０２－２９')).toBe('2020-02-29');
  });

  it('inserts slashes for exactly 8 digits only', () => {
    expect(normalizeDateInput('20260306')).toBe('2026/03/06');
    expect(normalizeDateInput('202603')).toBe('202603');
  });
});

describe('parseDateInput', () => {
  it('accepts YYYY/MM/DD with any supported separator or bare digits', () => {
    expect(parseDateInput('2020/02/29')).toBe('2020-02-29');
    expect(parseDateInput('2020-02-29')).toBe('2020-02-29');
    expect(parseDateInput('2020.2.9')).toBe('2020-02-09');
    expect(parseDateInput(' 20200229 ')).toBe('2020-02-29');
  });

  it('rejects non-existent, out-of-range or partial dates', () => {
    expect(parseDateInput('2021/02/29')).toBeNull();
    expect(parseDateInput('2026/13/01')).toBeNull();
    expect(parseDateInput('0999/12/31')).toBeNull();
    expect(parseDateInput('2026/03')).toBeNull();
    expect(parseDateInput('')).toBeNull();
  });
});
