// 一覧 API の不透明カーソル（created_at + id のキーセット）。純粋モジュール。

export interface ListCursor {
  createdAt: string;
  id: string;
}

const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;
const ID_RE = /^[0-9a-f-]{1,64}$/i;

function toBase64Url(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(s: string): string {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

export function encodeCursor(cursor: ListCursor): string {
  return toBase64Url(JSON.stringify([cursor.createdAt, cursor.id]));
}

/** 不正なカーソルは null（呼び出し側で 400 にする）。 */
export function decodeCursor(raw: string | null | undefined): ListCursor | null {
  if (!raw || raw.length > 256 || !/^[A-Za-z0-9_-]+$/.test(raw)) return null;
  try {
    const parsed: unknown = JSON.parse(fromBase64Url(raw));
    if (!Array.isArray(parsed) || parsed.length !== 2) return null;
    const [createdAt, id] = parsed;
    if (typeof createdAt !== 'string' || typeof id !== 'string') return null;
    if (!ISO_RE.test(createdAt) || !ID_RE.test(id)) return null;
    return { createdAt, id };
  } catch {
    return null;
  }
}

/** `limit` クエリを解釈する。未指定は既定値、範囲外は丸め、数値でなければ null。 */
export function parseLimit(raw: string | null | undefined, def: number, max: number): number | null {
  if (raw === null || raw === undefined || raw === '') return def;
  if (!/^\d{1,4}$/.test(raw)) return null;
  const n = Number(raw);
  if (n < 1) return null;
  return Math.min(n, max);
}
