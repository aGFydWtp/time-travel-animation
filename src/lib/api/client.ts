// Typed fetch wrapper for the render API (contract: ./types.ts).
import type { RenderConfig } from '../renderer/types.ts';
import type {
  ApiErrorBody,
  CreateRenderRequest,
  CreateRenderResponse,
  ListRendersResponse,
  RenderJob,
  RetryRenderResponse,
} from './types.ts';

export type ApiErrorCode = ApiErrorBody['error']['code'] | 'network' | 'http_error' | 'timeout' | 'aborted';

/** A request that hasn't finished (including reading the body) by then fails with code `timeout`. */
export const REQUEST_TIMEOUT_MS = 20_000;

export class ApiError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode;
  readonly issues: NonNullable<ApiErrorBody['error']['issues']>;
  /** Seconds from a `Retry-After` header, when present. */
  readonly retryAfterSeconds: number | null;

  constructor(
    status: number,
    code: ApiErrorCode,
    message: string,
    issues: ApiErrorBody['error']['issues'] = [],
    retryAfterSeconds: number | null = null,
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.issues = issues ?? [];
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

function isApiErrorBody(value: unknown): value is ApiErrorBody {
  if (typeof value !== 'object' || value === null) return false;
  const error = (value as { error?: unknown }).error;
  return (
    typeof error === 'object' &&
    error !== null &&
    typeof (error as { code?: unknown }).code === 'string' &&
    typeof (error as { message?: unknown }).message === 'string'
  );
}

function parseRetryAfter(header: string | null): number | null {
  if (!header) return null;
  const seconds = Number(header);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : null;
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** Per-call options: `signal` lets the caller cancel (e.g. when a page unmounts). */
export interface RequestOptions {
  signal?: AbortSignal;
}

export interface ApiClient {
  createRender(config: RenderConfig, idempotencyKey?: string, options?: RequestOptions): Promise<CreateRenderResponse>;
  listRenders(
    params?: { cursor?: string | null; limit?: number },
    options?: RequestOptions,
  ): Promise<ListRendersResponse>;
  getRender(id: string, options?: RequestOptions): Promise<RenderJob>;
  retryRender(id: string, options?: RequestOptions): Promise<RetryRenderResponse>;
}

export function createApiClient(
  fetchImpl: FetchLike = (input, init) => fetch(input, init),
  { timeoutMs = REQUEST_TIMEOUT_MS }: { timeoutMs?: number } = {},
): ApiClient {
  async function request<T>(path: string, init?: RequestInit, signal?: AbortSignal): Promise<T> {
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    const forwardAbort = () => controller.abort();
    if (signal?.aborted) controller.abort();
    else signal?.addEventListener('abort', forwardAbort, { once: true });

    let res: Response;
    let text: string;
    try {
      res = await fetchImpl(path, {
        ...init,
        headers: { accept: 'application/json', ...(init?.body ? { 'content-type': 'application/json' } : {}) },
        credentials: 'same-origin',
        signal: controller.signal,
      });
      text = await res.text();
    } catch {
      if (timedOut) throw new ApiError(0, 'timeout', 'Request timed out');
      if (signal?.aborted) throw new ApiError(0, 'aborted', 'Request aborted');
      throw new ApiError(0, 'network', 'Network request failed');
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', forwardAbort);
    }

    let body: unknown = null;
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        body = null;
      }
    }

    if (!res.ok) {
      const retryAfter = parseRetryAfter(res.headers.get('retry-after'));
      if (isApiErrorBody(body)) {
        throw new ApiError(res.status, body.error.code, body.error.message, body.error.issues, retryAfter);
      }
      const code: ApiErrorCode = res.status === 429 ? 'rate_limited' : 'http_error';
      throw new ApiError(res.status, code, `HTTP ${res.status}`, [], retryAfter);
    }
    if (body === null) throw new ApiError(res.status, 'http_error', 'Empty or non-JSON response');
    return body as T;
  }

  return {
    createRender(config, idempotencyKey, options) {
      const payload: CreateRenderRequest = idempotencyKey ? { config, idempotencyKey } : { config };
      return request<CreateRenderResponse>(
        '/api/renders',
        { method: 'POST', body: JSON.stringify(payload) },
        options?.signal,
      );
    },
    listRenders(params = {}, options) {
      const qs = new URLSearchParams();
      if (params.cursor) qs.set('cursor', params.cursor);
      if (params.limit) qs.set('limit', String(params.limit));
      const query = qs.toString();
      return request<ListRendersResponse>(`/api/renders${query ? `?${query}` : ''}`, undefined, options?.signal);
    },
    getRender(id, options) {
      return request<RenderJob>(`/api/renders/${encodeURIComponent(id)}`, undefined, options?.signal);
    },
    retryRender(id, options) {
      return request<RetryRenderResponse>(
        `/api/renders/${encodeURIComponent(id)}/retry`,
        { method: 'POST' },
        options?.signal,
      );
    },
  };
}

/** Japanese, user-facing description of an API failure (never shows internals). */
export function describeApiError(error: unknown): string {
  if (!(error instanceof ApiError)) return '予期しないエラーが発生しました。ページを再読み込みしてください。';
  switch (error.code) {
    case 'rate_limited': {
      const wait = error.retryAfterSeconds ? `約 ${Math.ceil(error.retryAfterSeconds)} 秒後に` : '進行中の書き出しが終わってから';
      return `書き出しの上限に達しています。${wait}もう一度お試しください。`;
    }
    case 'invalid_request':
      return '設定内容がサーバーで受け付けられませんでした。入力値を確認してください。';
    case 'unauthorized':
      return 'ログインが必要です。ページを再読み込みしてください。';
    case 'forbidden':
      return 'このアカウントには書き出しの権限がありません。';
    case 'auth_not_configured':
      return 'サーバーの認証設定が完了していないため、書き出しできません。';
    case 'not_found':
      return '対象の書き出しジョブが見つかりません。';
    case 'conflict':
      return 'このジョブは現在の状態では操作できません。一覧を更新してください。';
    case 'not_ready':
      return '書き出しファイルはまだ準備できていません。';
    case 'timeout':
      return 'サーバーから応答がありませんでした。時間をおいてもう一度お試しください。';
    case 'network':
      return 'サーバーに接続できませんでした。通信状況を確認してください。';
    default:
      return 'サーバーでエラーが発生しました。時間をおいてもう一度お試しください。';
  }
}

export const api: ApiClient = createApiClient();
