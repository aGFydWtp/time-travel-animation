import { describe, expect, it } from 'vitest';
import { ApiError } from '../../../src/server/errors.ts';
import {
  assertStateChangingRequest,
  checkStateChangingRequest,
  isJsonContentType,
  type GuardRequest,
} from '../../../src/server/request-guard.ts';

const URL_ = 'https://dcs.example.com/api/renders';

function req(headers: Record<string, string>, url = URL_): GuardRequest {
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return { url, header: (name) => lower[name.toLowerCase()] };
}

const sameOriginJson = {
  'sec-fetch-site': 'same-origin',
  origin: 'https://dcs.example.com',
  'content-type': 'application/json',
};

describe('isJsonContentType', () => {
  it('matches the media type and ignores parameters / case', () => {
    expect(isJsonContentType('application/json')).toBe(true);
    expect(isJsonContentType('Application/JSON; charset=utf-8')).toBe(true);
    expect(isJsonContentType('text/plain')).toBe(false);
    expect(isJsonContentType('text/plain; x=application/json')).toBe(false);
    expect(isJsonContentType('application/json-patch+json')).toBe(false);
    expect(isJsonContentType(undefined)).toBe(false);
  });
});

describe('checkStateChangingRequest (create: json required)', () => {
  const opts = { json: 'required' } as const;

  it('accepts a same-origin JSON request from the UI', () => {
    expect(checkStateChangingRequest(req(sameOriginJson), opts)).toEqual({ ok: true });
  });

  it('accepts a non-browser client with no Sec-Fetch-Site / Origin when the body is JSON', () => {
    expect(checkStateChangingRequest(req({ 'content-type': 'application/json' }), opts).ok).toBe(true);
  });

  it('rejects the no-cors text/plain cross-site POST', () => {
    const r = checkStateChangingRequest(
      req({ 'sec-fetch-site': 'cross-site', origin: 'https://evil.example', 'content-type': 'text/plain;charset=UTF-8' }),
      opts,
    );
    expect(r.ok).toBe(false);
  });

  it('rejects same-site and none (only same-origin is allowed)', () => {
    for (const site of ['same-site', 'none', 'cross-site']) {
      expect(checkStateChangingRequest(req({ ...sameOriginJson, 'sec-fetch-site': site }), opts).ok).toBe(false);
    }
  });

  it('rejects a mismatched or "null" Origin even without Sec-Fetch-Site', () => {
    const base = { 'content-type': 'application/json' };
    expect(checkStateChangingRequest(req({ ...base, origin: 'https://evil.example' }), opts).ok).toBe(false);
    expect(checkStateChangingRequest(req({ ...base, origin: 'null' }), opts).ok).toBe(false);
    expect(checkStateChangingRequest(req({ ...base, origin: 'http://dcs.example.com' }), opts).ok).toBe(false);
    expect(checkStateChangingRequest(req({ ...base, origin: 'https://dcs.example.com:8443' }), opts).ok).toBe(false);
  });

  it('compares against the request URL origin including the port (local dev)', () => {
    const local = req(
      { 'sec-fetch-site': 'same-origin', origin: 'http://localhost:5173', 'content-type': 'application/json' },
      'http://localhost:5173/api/renders',
    );
    expect(checkStateChangingRequest(local, opts).ok).toBe(true);
  });

  it('rejects same-origin requests that are not JSON', () => {
    for (const ct of ['text/plain', 'application/x-www-form-urlencoded', 'multipart/form-data; boundary=x']) {
      expect(checkStateChangingRequest(req({ ...sameOriginJson, 'content-type': ct }), opts).ok).toBe(false);
    }
    const { 'content-type': _, ...noCt } = sameOriginJson;
    expect(checkStateChangingRequest(req(noCt), opts).ok).toBe(false);
  });
});

describe('checkStateChangingRequest (retry: body optional)', () => {
  const opts = { json: 'if-present' } as const;

  it('accepts the UI retry (same-origin, no body, no content-type)', () => {
    expect(
      checkStateChangingRequest(req({ 'sec-fetch-site': 'same-origin', origin: 'https://dcs.example.com' }), opts).ok,
    ).toBe(true);
  });

  it('rejects a cross-site retry even without a body', () => {
    expect(checkStateChangingRequest(req({ 'sec-fetch-site': 'cross-site', origin: 'https://evil.example' }), opts).ok).toBe(
      false,
    );
    expect(checkStateChangingRequest(req({ origin: 'https://evil.example' }), opts).ok).toBe(false);
  });

  it('rejects a form-encoded retry body', () => {
    expect(
      checkStateChangingRequest(
        req({ 'sec-fetch-site': 'same-origin', 'content-type': 'application/x-www-form-urlencoded' }),
        opts,
      ).ok,
    ).toBe(false);
  });
});

describe('assertStateChangingRequest', () => {
  it('throws ApiError 403 forbidden with an ApiErrorBody', () => {
    try {
      assertStateChangingRequest(req({ 'sec-fetch-site': 'cross-site' }), { json: 'required' });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      const e = err as ApiError;
      expect(e.status).toBe(403);
      expect(e.toBody().error.code).toBe('forbidden');
    }
  });
});
