// 状態を変える API（POST）のクロスサイト送信対策（純粋モジュール）。
// `fetch(url, { mode: 'no-cors', credentials: 'include', body: '<json>' })` は text/plain の
// 「単純リクエスト」になりプリフライトを経ないため、Cloudflare Access の Cookie が付けば他サイトから
// ジョブを作れてしまう。ブラウザが付ける Sec-Fetch-Site / Origin と Content-Type で弾く。
import { ApiError } from './errors.ts';

export interface GuardRequest {
  /** リクエスト URL（絶対 URL） */
  url: string;
  header(name: string): string | undefined;
}

export interface GuardOptions {
  /**
   * 'required': Content-Type が application/json でなければ拒否（ボディ付き POST）。
   * 'if-present': Content-Type があるときだけ application/json を要求（ボディ無し POST）。
   */
  json: 'required' | 'if-present';
}

export type GuardResult = { ok: true } | { ok: false; reason: string };

/** `application/json; charset=utf-8` などパラメータ付きも許す（メディアタイプだけを比較する） */
export function isJsonContentType(raw: string | undefined): boolean {
  if (!raw) return false;
  return raw.split(';', 1)[0]!.trim().toLowerCase() === 'application/json';
}

function originOf(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

export function checkStateChangingRequest(req: GuardRequest, opts: GuardOptions): GuardResult {
  // Sec-Fetch-Site は対応ブラウザなら必ず付く。same-origin 以外（same-site / cross-site / none）は拒否。
  // 無い場合（古いブラウザ・curl 等の非ブラウザ）は Origin の検査に委ねる。
  const site = req.header('sec-fetch-site');
  if (site !== undefined && site.trim().toLowerCase() !== 'same-origin') {
    return { ok: false, reason: `sec-fetch-site=${site}` };
  }

  // Origin があれば（POST ではブラウザが付ける）リクエスト URL のオリジンと一致を要求する。"null" も拒否。
  const origin = req.header('origin');
  if (origin !== undefined) {
    const expected = originOf(req.url);
    if (!expected || origin.trim() !== expected) return { ok: false, reason: 'origin_mismatch' };
  }

  const contentType = req.header('content-type');
  if (opts.json === 'required' && !isJsonContentType(contentType)) {
    return { ok: false, reason: 'content_type_not_json' };
  }
  if (opts.json === 'if-present' && contentType !== undefined && contentType.trim() !== '' && !isJsonContentType(contentType)) {
    return { ok: false, reason: 'content_type_not_json' };
  }
  return { ok: true };
}

/** 拒否なら ApiError(403, 'forbidden') を投げる */
export function assertStateChangingRequest(req: GuardRequest, opts: GuardOptions): void {
  const result = checkStateChangingRequest(req, opts);
  if (!result.ok) {
    throw new ApiError(403, 'forbidden', 'このリクエストは受け付けられません（同一オリジンの JSON リクエストのみ）');
  }
}
