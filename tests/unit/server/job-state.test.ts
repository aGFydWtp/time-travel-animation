import { describe, expect, it } from 'vitest';
import { canonicalConfigString, DEFAULT_CONFIG } from '../../../src/lib/renderer/index.ts';
import { ApiError } from '../../../src/server/errors.ts';
import {
  assetKeys,
  decideAssetAccess,
  decideCreate,
  downloadFileName,
  ownerHash,
  progressPatch,
  sanitizeErrorCode,
  toRenderJob,
} from '../../../src/server/job-state.ts';
import { parseCreateRequest, requireJobId } from '../../../src/server/request.ts';
import { makeJob, OWNER } from './fake-store.ts';

const NOW = new Date('2026-11-08T12:00:00.000Z');

function completed(over = {}) {
  return makeJob({
    status: 'completed',
    stage: 'done',
    progress: 100,
    mp4Key: 'renders/h/j/preview.mp4',
    movKey: 'renders/h/j/transparent.mov',
    mp4Bytes: 10,
    movBytes: 20,
    completedAt: '2026-11-08T11:00:00.000Z',
    expiresAt: '2026-12-08T11:00:00.000Z',
    ...over,
  });
}

describe('toRenderJob', () => {
  it('restores the transparent background omitted from the canonical configJson; keeps a solid one', () => {
    expect(JSON.parse(completed().configJson)).not.toHaveProperty('background');
    expect(toRenderJob(completed(), NOW).config.background).toBe('transparent');
    const green = { ...DEFAULT_CONFIG, background: '#00FF00' as const };
    const dto = toRenderJob(completed({ configJson: canonicalConfigString(green) }), NOW);
    expect(dto.config).toEqual(green);
    // a solid-background job still has both assets (an opaque MOV)
    expect(dto.assets?.mov.format).toBe('mov');
  });

  it('never exposes asset URLs before completion', () => {
    for (const status of ['queued', 'running', 'failed']) {
      const dto = toRenderJob(makeJob({ status, mp4Key: 'k', movKey: 'k2' }), NOW);
      expect(dto.assets).toBeNull();
      expect(dto.expiresAt).toBeNull();
    }
  });

  it('returns asset info for completed, unexpired jobs', () => {
    const job = completed();
    const dto = toRenderJob(job, NOW);
    expect(dto.config).toEqual(DEFAULT_CONFIG);
    expect(dto.expired).toBe(false);
    expect(dto.assets).toEqual({
      mp4: {
        format: 'mp4',
        contentType: 'video/mp4',
        bytes: 10,
        url: `/api/renders/${job.id}/assets/mp4`,
        downloadUrl: `/api/renders/${job.id}/assets/mp4?download=1`,
      },
      mov: {
        format: 'mov',
        contentType: 'video/quicktime',
        bytes: 20,
        url: `/api/renders/${job.id}/assets/mov`,
        downloadUrl: `/api/renders/${job.id}/assets/mov?download=1`,
      },
    });
  });

  it('reports expired (and hides assets) once past expires_at or flagged by the sweep', () => {
    expect(toRenderJob(completed({ expiresAt: '2026-11-08T11:59:59.000Z' }), NOW)).toMatchObject({
      expired: true,
      assets: null,
    });
    expect(toRenderJob(completed({ expired: 1 }), NOW)).toMatchObject({ expired: true, assets: null });
  });

  it('exposes only sanitized errors for failed jobs', () => {
    const dto = toRenderJob(makeJob({ status: 'failed', errorCode: 'weird', errorMessage: 'stack trace...' }), NOW);
    expect(dto.error).toEqual({ code: 'render_failed', message: '動画のレンダリングに失敗しました' });
  });
});

describe('decideAssetAccess', () => {
  it('rejects downloads before completion with 409 not_ready', () => {
    for (const status of ['queued', 'running', 'failed']) {
      expect(decideAssetAccess(makeJob({ status }), OWNER, 'mp4', NOW)).toMatchObject({
        ok: false,
        status: 409,
        code: 'not_ready',
      });
    }
  });

  it("treats another owner's job as not found", () => {
    expect(decideAssetAccess(completed(), 'someone@else.com', 'mp4', NOW)).toMatchObject({
      ok: false,
      status: 404,
      code: 'not_found',
    });
    expect(decideAssetAccess(null, OWNER, 'mp4', NOW)).toMatchObject({ status: 404 });
  });

  it('rejects unknown formats and expired assets with 404', () => {
    expect(decideAssetAccess(completed(), OWNER, 'png', NOW)).toMatchObject({ status: 404 });
    expect(decideAssetAccess(completed({ expired: 1 }), OWNER, 'mp4', NOW)).toMatchObject({ status: 404 });
  });

  it('returns the R2 key and content type for completed jobs', () => {
    expect(decideAssetAccess(completed(), OWNER, 'mov', NOW)).toEqual({
      ok: true,
      key: 'renders/h/j/transparent.mov',
      contentType: 'video/quicktime',
      bytes: 20,
    });
  });

  it('generates a safe download filename', () => {
    expect(downloadFileName('0b7c8d0e-1111-4222-8333-944455556666', 'mp4')).toBe('countdown-0b7c8d0e.mp4');
    expect(downloadFileName('"; rm -rf', 'mov')).toBe('countdown-rmrf.mov');
  });
});

describe('decideCreate', () => {
  const base = { idempotent: null, active: [], configHash: 'h1', recentCount: 0, activeLimit: 1, hourlyLimit: 20 };

  it('creates when nothing is active', () => {
    expect(decideCreate(base)).toEqual({ kind: 'create' });
  });

  it('reuses an in-progress job with the same config hash', () => {
    const active = [{ id: 'a', status: 'running', configHash: 'h1' }];
    expect(decideCreate({ ...base, active })).toEqual({ kind: 'reuse', job: active[0] });
  });

  it('reuses the job created with the same idempotency key', () => {
    const idempotent = { id: 'b', status: 'completed' };
    expect(decideCreate({ ...base, idempotent })).toEqual({ kind: 'reuse', job: idempotent });
  });

  it('rate-limits a second active job with a different config', () => {
    const active = [{ id: 'a', status: 'queued', configHash: 'other' }];
    expect(decideCreate({ ...base, active })).toMatchObject({ kind: 'rate_limited' });
  });

  it('rate-limits after the hourly cap', () => {
    expect(decideCreate({ ...base, recentCount: 20 })).toMatchObject({ kind: 'rate_limited' });
  });
});

describe('sanitizing and keys', () => {
  it('maps container error codes and rejects unknown ones', () => {
    expect(sanitizeErrorCode('VERIFY_FAILED')).toBe('verification_failed');
    expect(sanitizeErrorCode('ENCODE_MP4_FAILED')).toBe('encode_failed');
    expect(sanitizeErrorCode('timeout')).toBe('timeout');
    expect(sanitizeErrorCode('__proto__')).toBe('render_failed');
    expect(sanitizeErrorCode(undefined)).toBe('render_failed');
  });

  it('clamps progress and ignores unknown stages', () => {
    const now = new Date(0);
    expect(progressPatch('rendering', 42.4, now)).toEqual({
      stage: 'rendering_frames',
      progress: 42,
      updatedAt: now.toISOString(),
    });
    expect(progressPatch('done', 100, now)).toEqual({ progress: 99, updatedAt: now.toISOString() });
    expect(progressPatch('x', 'NaN', now)).toEqual({ progress: 0, updatedAt: now.toISOString() });
  });

  it('builds R2 keys from a hash of the owner, never the raw email', async () => {
    const h = await ownerHash(OWNER);
    expect(h).toMatch(/^[0-9a-f]{16}$/);
    const keys = await assetKeys(OWNER, 'job-1');
    expect(keys).toEqual({
      mp4: `renders/${h}/job-1/preview.mp4`,
      mov: `renders/${h}/job-1/transparent.mov`,
      metadata: `renders/${h}/job-1/metadata.json`,
    });
  });
});

describe('request parsing', () => {
  it('accepts and normalizes a valid body', () => {
    const r = parseCreateRequest(
      JSON.stringify({ config: { ...DEFAULT_CONFIG, color: '#ffffff' }, idempotencyKey: 'abc-12345' }),
    );
    expect(r.config.color).toBe('#FFFFFF');
    expect(r.idempotencyKey).toBe('abc-12345');
  });

  it('rejects invalid JSON, unknown keys and disallowed configs with 400 issues', () => {
    const err = (body: string) => {
      try {
        parseCreateRequest(body);
      } catch (e) {
        return e as ApiError;
      }
      throw new Error('expected failure');
    };
    expect(err('{').status).toBe(400);
    expect(err(JSON.stringify({ config: DEFAULT_CONFIG, extra: 1 })).code).toBe('invalid_request');
    const e = err(JSON.stringify({ config: { ...DEFAULT_CONFIG, width: 3840, fontFamily: '../etc' } }));
    expect(e.status).toBe(400);
    expect(e.issues?.some((i) => i.path[0] === 'config')).toBe(true);
    expect(err(JSON.stringify({ config: DEFAULT_CONFIG, idempotencyKey: 'a b' })).status).toBe(400);
    expect(err('x'.repeat(20_000)).status).toBe(400);
  });

  it('treats malformed job ids as not found', () => {
    expect(() => requireJobId('../../etc')).toThrowError(ApiError);
    expect(requireJobId('0B7C8D0E-1111-4222-8333-944455556666')).toBe('0b7c8d0e-1111-4222-8333-944455556666');
  });
});
