// HTTP Range ヘッダー（単一の bytes 範囲のみ）の解釈。純粋モジュール。

export type RangeResult =
  | { kind: 'full' }
  | { kind: 'partial'; start: number; end: number; length: number }
  | { kind: 'unsatisfiable' };

/**
 * RFC 9110 の `bytes=` 範囲を解釈する。
 * - ヘッダー無し / 構文不正 / 複数範囲 / bytes 以外の単位 → full（全体を 200 で返す。RFC 上、無視してよい）
 * - 満たせない範囲 → unsatisfiable（416）
 */
export function parseRange(header: string | null | undefined, size: number): RangeResult {
  if (!header) return { kind: 'full' };
  const m = /^\s*bytes\s*=\s*(\d*)\s*-\s*(\d*)\s*$/i.exec(header);
  if (!m) return { kind: 'full' };
  const [, startStr, endStr] = m;
  if (startStr === '' && endStr === '') return { kind: 'full' };

  if (size <= 0) return { kind: 'unsatisfiable' };

  let start: number;
  let end: number;
  if (startStr === '') {
    // suffix: 末尾 N バイト
    const suffix = Number(endStr);
    if (suffix === 0) return { kind: 'unsatisfiable' };
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(startStr);
    end = endStr === '' ? size - 1 : Math.min(Number(endStr), size - 1);
    if (start >= size) return { kind: 'unsatisfiable' };
    if (endStr !== '' && Number(endStr) < start) return { kind: 'full' };
  }
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)) return { kind: 'full' };
  return { kind: 'partial', start, end, length: end - start + 1 };
}

export function contentRangeHeader(start: number, end: number, size: number): string {
  return `bytes ${start}-${end}/${size}`;
}

/** If-None-Match が ETag と一致するか（弱比較、`*` 対応）。 */
export function etagMatches(ifNoneMatch: string | null | undefined, etag: string): boolean {
  if (!ifNoneMatch) return false;
  const strip = (t: string) => t.trim().replace(/^W\//, '');
  const target = strip(etag);
  return ifNoneMatch.split(',').some((t) => t.trim() === '*' || strip(t) === target);
}
