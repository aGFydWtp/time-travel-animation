import { describe, expect, it } from 'vitest';
import { decodeCursor, encodeCursor, parseLimit } from '../../../src/server/cursor.ts';
import { contentRangeHeader, etagMatches, parseRange } from '../../../src/server/range.ts';

describe('parseRange', () => {
  const size = 1000;

  it('returns full when there is no or an unsupported header', () => {
    expect(parseRange(null, size)).toEqual({ kind: 'full' });
    expect(parseRange('items=0-10', size)).toEqual({ kind: 'full' });
    expect(parseRange('bytes=0-1,5-9', size)).toEqual({ kind: 'full' });
    expect(parseRange('bytes=-', size)).toEqual({ kind: 'full' });
    expect(parseRange('bytes=500-100', size)).toEqual({ kind: 'full' });
  });

  it('parses closed, open-ended and suffix ranges', () => {
    expect(parseRange('bytes=0-99', size)).toEqual({ kind: 'partial', start: 0, end: 99, length: 100 });
    expect(parseRange('bytes=900-', size)).toEqual({ kind: 'partial', start: 900, end: 999, length: 100 });
    expect(parseRange('bytes=-100', size)).toEqual({ kind: 'partial', start: 900, end: 999, length: 100 });
    expect(parseRange('bytes=0-', size)).toEqual({ kind: 'partial', start: 0, end: 999, length: 1000 });
  });

  it('clamps the end and suffix to the object size', () => {
    expect(parseRange('bytes=990-5000', size)).toEqual({ kind: 'partial', start: 990, end: 999, length: 10 });
    expect(parseRange('bytes=-5000', size)).toEqual({ kind: 'partial', start: 0, end: 999, length: 1000 });
  });

  it('reports unsatisfiable ranges', () => {
    expect(parseRange('bytes=1000-', size)).toEqual({ kind: 'unsatisfiable' });
    expect(parseRange('bytes=-0', size)).toEqual({ kind: 'unsatisfiable' });
    expect(parseRange('bytes=0-10', 0)).toEqual({ kind: 'unsatisfiable' });
  });

  it('formats Content-Range', () => {
    expect(contentRangeHeader(0, 99, 1000)).toBe('bytes 0-99/1000');
  });

  it('matches If-None-Match against the ETag', () => {
    expect(etagMatches('"abc"', '"abc"')).toBe(true);
    expect(etagMatches('W/"abc", "x"', '"abc"')).toBe(true);
    expect(etagMatches('*', '"abc"')).toBe(true);
    expect(etagMatches('"x"', '"abc"')).toBe(false);
    expect(etagMatches(null, '"abc"')).toBe(false);
  });
});

describe('cursor', () => {
  const c = { createdAt: '2026-11-08T00:00:04.123Z', id: '0b7c8d0e-1111-4222-8333-944455556666' };

  it('round-trips and is URL safe', () => {
    const encoded = encodeCursor(c);
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeCursor(encoded)).toEqual(c);
  });

  it('rejects tampered or malformed cursors', () => {
    expect(decodeCursor('')).toBeNull();
    expect(decodeCursor('!!!')).toBeNull();
    expect(decodeCursor(encodeCursor({ createdAt: 'yesterday', id: c.id }))).toBeNull();
    expect(decodeCursor(encodeCursor({ createdAt: c.createdAt, id: "x' OR 1=1" }))).toBeNull();
    expect(decodeCursor(btoa('{"a":1}').replace(/=+$/, ''))).toBeNull();
    expect(decodeCursor('a'.repeat(300))).toBeNull();
  });

  it('parses limit with default and max', () => {
    expect(parseLimit(undefined, 20, 50)).toBe(20);
    expect(parseLimit('5', 20, 50)).toBe(5);
    expect(parseLimit('500', 20, 50)).toBe(50);
    expect(parseLimit('0', 20, 50)).toBeNull();
    expect(parseLimit('abc', 20, 50)).toBeNull();
    expect(parseLimit('-1', 20, 50)).toBeNull();
  });
});
