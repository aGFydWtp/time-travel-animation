import { describe, expect, it } from 'vitest';
import { ApiError, createApiClient, describeApiError, type FetchLike } from '../api/client.ts';
import { DEFAULT_CONFIG } from '../renderer/types.ts';

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(body === undefined ? '' : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

function recordingFetch(response: () => Response) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    calls.push({ url, init });
    return response();
  };
  return { calls, fetchImpl };
}

describe('createApiClient', () => {
  it('POSTs the config as JSON', async () => {
    const { calls, fetchImpl } = recordingFetch(() => jsonResponse(202, { id: 'j1', status: 'queued', reused: false }));
    const client = createApiClient(fetchImpl);
    const res = await client.createRender({ ...DEFAULT_CONFIG }, 'key-1');
    expect(res).toEqual({ id: 'j1', status: 'queued', reused: false });
    expect(calls[0]?.url).toBe('/api/renders');
    expect(calls[0]?.init?.method).toBe('POST');
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({ config: DEFAULT_CONFIG, idempotencyKey: 'key-1' });
  });

  it('builds list query strings and encodes ids', async () => {
    const { calls, fetchImpl } = recordingFetch(() => jsonResponse(200, { items: [], nextCursor: null }));
    const client = createApiClient(fetchImpl);
    await client.listRenders();
    await client.listRenders({ cursor: 'c/1', limit: 20 });
    expect(calls[0]?.url).toBe('/api/renders');
    expect(calls[1]?.url).toBe('/api/renders?cursor=c%2F1&limit=20');
    await client.retryRender('a/b').catch(() => undefined);
    expect(calls[2]?.url).toBe('/api/renders/a%2Fb/retry');
  });

  it('throws ApiError with code, issues and Retry-After from ApiErrorBody', async () => {
    const { fetchImpl } = recordingFetch(() =>
      jsonResponse(429, { error: { code: 'rate_limited', message: 'Too many' } }, { 'retry-after': '30' }),
    );
    const err = await createApiClient(fetchImpl)
      .createRender({ ...DEFAULT_CONFIG })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(429);
    expect((err as ApiError).code).toBe('rate_limited');
    expect((err as ApiError).retryAfterSeconds).toBe(30);
    expect(describeApiError(err)).toContain('約 30 秒後');
  });

  it('treats a bare 429 as rate_limited and non-JSON errors as http_error', async () => {
    const bare429 = await createApiClient(async () => new Response('slow down', { status: 429 }))
      .getRender('x')
      .then(
        () => {
          throw new Error('expected rejection');
        },
        (e: unknown) => e as ApiError,
      );
    expect(bare429.code).toBe('rate_limited');
    const html404 = await createApiClient(async () => new Response('<html>', { status: 404 }))
      .getRender('x')
      .then(
        () => {
          throw new Error('expected rejection');
        },
        (e: unknown) => e as ApiError,
      );
    expect(html404.code).toBe('http_error');
    expect(html404.status).toBe(404);
  });

  it('maps fetch rejections to a network error', async () => {
    const err = await createApiClient(async () => {
      throw new TypeError('Failed to fetch');
    })
      .getRender('x')
      .then(
        () => {
          throw new Error('expected rejection');
        },
        (e: unknown) => e as ApiError,
      );
    expect(err.code).toBe('network');
    expect(describeApiError(err)).toContain('接続できませんでした');
  });
});

describe('describeApiError', () => {
  it('never echoes server messages and handles unknown errors', () => {
    const msg = describeApiError(new ApiError(500, 'internal', 'stack trace /usr/bin/ffmpeg'));
    expect(msg).not.toContain('ffmpeg');
    expect(describeApiError(new Error('x'))).toContain('予期しないエラー');
  });
});
