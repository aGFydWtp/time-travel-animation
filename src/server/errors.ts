// API エラー（ApiErrorBody 準拠）。void/* を import しない純粋モジュール。
import type { ApiErrorBody } from '../lib/api/types.ts';
import { errorSummary } from './log.ts';

export type ApiErrorCode = ApiErrorBody['error']['code'];
export type ApiIssue = NonNullable<ApiErrorBody['error']['issues']>[number];

export class ApiError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode;
  readonly issues?: ApiIssue[];
  readonly headers?: Record<string, string>;

  constructor(
    status: number,
    code: ApiErrorCode,
    message: string,
    opts: { issues?: ApiIssue[]; headers?: Record<string, string> } = {},
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.issues = opts.issues;
    this.headers = opts.headers;
  }

  toBody(): ApiErrorBody {
    const error: ApiErrorBody['error'] = { code: this.code, message: this.message };
    if (this.issues) error.issues = this.issues;
    return { error };
  }
}

export function errorBody(code: ApiErrorCode, message: string): ApiErrorBody {
  return { error: { code, message } };
}

/** ApiError 以外は 500 internal に丸める（スタックトレースや内部メッセージは返さない）。 */
export function toErrorResponse(err: unknown): Response {
  const apiErr =
    err instanceof ApiError ? err : new ApiError(500, 'internal', 'サーバー内部でエラーが発生しました');
  return new Response(JSON.stringify(apiErr.toBody()), {
    status: apiErr.status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...apiErr.headers,
    },
  });
}

/** ルートハンドラー本体を包み、例外を ApiErrorBody のレスポンスに変換する。 */
export async function handleApi(route: string, fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (err) {
    if (!(err instanceof ApiError)) {
      console.log(JSON.stringify({ event: 'api.unhandled_error', route, error: errorSummary(err) }));
    }
    return toErrorResponse(err);
  }
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}
