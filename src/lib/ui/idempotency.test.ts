import { describe, expect, it } from 'vitest';
import { ApiError } from '../api/client.ts';
import { IdempotencyKeys, isTerminalCreateError } from './idempotency.ts';

function counter() {
  let n = 0;
  return () => `key-${++n}`;
}

describe('IdempotencyKeys', () => {
  it('reuses the key for the same hash until settled', () => {
    const keys = new IdempotencyKeys(counter());
    expect(keys.keyFor('h1')).toBe('key-1');
    expect(keys.keyFor('h1')).toBe('key-1');
    keys.settle();
    expect(keys.keyFor('h1')).toBe('key-2');
  });

  it('issues a new key when the hash changes', () => {
    const keys = new IdempotencyKeys(counter());
    expect(keys.keyFor('h1')).toBe('key-1');
    expect(keys.keyFor('h2')).toBe('key-2');
    // Going back to an earlier config is a new request too.
    expect(keys.keyFor('h1')).toBe('key-3');
  });

  it('defaults to random UUIDs', () => {
    const keys = new IdempotencyKeys();
    expect(keys.keyFor('h')).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe('isTerminalCreateError', () => {
  it('treats 4xx as terminal', () => {
    expect(isTerminalCreateError(new ApiError(400, 'invalid_request', 'x'))).toBe(true);
    expect(isTerminalCreateError(new ApiError(429, 'rate_limited', 'x'))).toBe(true);
  });

  it('keeps the key for network errors, 5xx and unknown errors', () => {
    expect(isTerminalCreateError(new ApiError(0, 'network', 'x'))).toBe(false);
    expect(isTerminalCreateError(new ApiError(503, 'http_error', 'x'))).toBe(false);
    expect(isTerminalCreateError(new Error('boom'))).toBe(false);
  });
});
