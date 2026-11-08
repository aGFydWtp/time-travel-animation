import { describe, expect, it, vi } from 'vitest';
import { processRenderMessage, type ProcessorDeps, type RunResult } from '../../../src/server/render-processor.ts';
import { toRenderJob } from '../../../src/server/job-state.ts';
import { FakeJobStore, makeJob } from './fake-store.ts';

class FakeUsageLimit extends Error {
  override name = 'SandboxLimitError';
}

const NOW = new Date('2026-11-08T01:00:00.000Z');

function setup(run: ProcessorDeps['run']) {
  const store = new FakeJobStore();
  const log = vi.fn();
  const runSpy = vi.fn(run);
  const deps: ProcessorDeps = {
    now: () => NOW,
    claim: (id, patch) => store.claim(id, patch),
    update: (id, patch, opts) => store.updateIf(id, 'running', patch, opts),
    run: runSpy,
    isUsageLimit: (err) => err instanceof FakeUsageLimit,
    retentionDays: 30,
    log,
  };
  return { store, deps, runSpy, log };
}

const okResult: RunResult = { ok: true, mp4: { bytes: 1234 }, mov: { bytes: 98765 } };

describe('processRenderMessage', () => {
  it('claims a queued job, renders, and completes it with keys, sizes and expiry', async () => {
    const { store, deps, runSpy } = setup(async (_id, _cfg, _keys, onProgress) => {
      await onProgress({ stage: 'rendering', progress: 40 });
      return okResult;
    });
    const job = store.add(makeJob());

    const action = await processRenderMessage(deps, job.id);

    expect(action).toEqual({ type: 'ack', reason: 'completed' });
    expect(runSpy).toHaveBeenCalledTimes(1);
    const keys = runSpy.mock.calls[0]![2];
    expect(keys.mp4).toMatch(new RegExp(`^renders/[0-9a-f]{16}/${job.id}/preview\\.mp4$`));
    expect(keys.mov).toMatch(/\/transparent\.mov$/);
    expect(keys.mp4).not.toContain('owner@example.com');

    const row = store.get(job.id);
    expect(row).toMatchObject({
      status: 'completed',
      stage: 'done',
      progress: 100,
      attempt: 1,
      mp4Bytes: 1234,
      movBytes: 98765,
      mp4Key: keys.mp4,
      movKey: keys.mov,
      completedAt: NOW.toISOString(),
      expiresAt: '2026-12-08T01:00:00.000Z',
    });
    expect(toRenderJob(row, NOW).assets?.mp4.url).toBe(`/api/renders/${job.id}/assets/mp4`);
  });

  it('acks and skips a duplicate delivery when the CAS updates 0 rows (already running)', async () => {
    const { store, deps, runSpy } = setup(async () => okResult);
    const job = store.add(makeJob({ status: 'running', attempt: 1 }));

    const action = await processRenderMessage(deps, job.id);

    expect(action).toEqual({ type: 'ack', reason: 'duplicate' });
    expect(runSpy).not.toHaveBeenCalled();
    expect(store.get(job.id)).toMatchObject({ status: 'running', attempt: 1 });
  });

  it('does not render twice when the same message is delivered twice', async () => {
    const { store, deps, runSpy } = setup(async () => okResult);
    const job = store.add(makeJob());

    const first = await processRenderMessage(deps, job.id);
    const second = await processRenderMessage(deps, job.id);

    expect(first.type).toBe('ack');
    expect(second).toEqual({ type: 'ack', reason: 'duplicate' });
    expect(runSpy).toHaveBeenCalledTimes(1);
    expect(store.get(job.id).status).toBe('completed');
  });

  it('acks unknown job ids without rendering', async () => {
    const { deps, runSpy } = setup(async () => okResult);
    expect(await processRenderMessage(deps, 'missing')).toEqual({ type: 'ack', reason: 'duplicate' });
    expect(runSpy).not.toHaveBeenCalled();
  });

  it('marks an encode failure as failed with a sanitized code and message', async () => {
    const { store, deps } = setup(async () => ({
      ok: false,
      errorCode: 'ENCODE_MOV_FAILED',
      message: 'ffmpeg -i /work/secret/path failed: Error at line 42',
    }));
    const job = store.add(makeJob());

    const action = await processRenderMessage(deps, job.id);

    expect(action).toEqual({ type: 'ack', reason: 'failed' });
    const row = store.get(job.id);
    expect(row.status).toBe('failed');
    expect(row.errorCode).toBe('encode_failed');
    expect(row.errorMessage).not.toContain('/work');
    expect(toRenderJob(row, NOW)).toMatchObject({
      status: 'failed',
      assets: null,
      error: { code: 'encode_failed' },
    });
  });

  it('maps unknown container error codes to render_failed', async () => {
    const { store, deps } = setup(async () => ({ ok: false, errorCode: '<script>', message: 'x' }));
    const job = store.add(makeJob());
    await processRenderMessage(deps, job.id);
    expect(store.get(job.id).errorCode).toBe('render_failed');
  });

  it('fails the job (not stuck in running) when the sandbox run throws', async () => {
    const { store, deps } = setup(async () => {
      throw new Error('binding SANDBOX not found\n    at stack frame');
    });
    const job = store.add(makeJob());

    const action = await processRenderMessage(deps, job.id);

    expect(action).toEqual({ type: 'ack', reason: 'failed' });
    expect(store.get(job.id)).toMatchObject({ status: 'failed', errorCode: 'render_failed' });
    expect(store.get(job.id).errorMessage).not.toContain('stack');
  });

  it('requeues on a sandbox usage limit and asks the queue to retry in 60s', async () => {
    const { store, deps } = setup(async () => {
      throw new FakeUsageLimit('concurrency');
    });
    const job = store.add(makeJob());

    const action = await processRenderMessage(deps, job.id);

    expect(action).toEqual({ type: 'retry', delaySeconds: 60 });
    expect(store.get(job.id)).toMatchObject({ status: 'queued', stage: 'queued', attempt: 0, startedAt: null });

    // 再配信で再び claim できる
    deps.run = vi.fn(async () => okResult);
    expect(await processRenderMessage(deps, job.id)).toEqual({ type: 'ack', reason: 'completed' });
    expect(store.get(job.id).attempt).toBe(1);
  });

  it('fails with invalid_config when the stored config no longer validates', async () => {
    const { store, deps, runSpy } = setup(async () => okResult);
    const job = store.add(makeJob({ configJson: JSON.stringify({ fps: 999 }) }));

    await processRenderMessage(deps, job.id);

    expect(runSpy).not.toHaveBeenCalled();
    expect(store.get(job.id)).toMatchObject({ status: 'failed', errorCode: 'invalid_config' });
  });

  it('maps container progress stages and never reports 100 before completion', async () => {
    let seen: unknown;
    const { store, deps } = setup(async (id, _c, _k, onProgress) => {
      await onProgress({ stage: 'encoding_mov', progress: 100 });
      seen = { ...store.get(id) };
      return okResult;
    });
    const job = store.add(makeJob());
    await processRenderMessage(deps, job.id);
    expect(seen).toMatchObject({ status: 'running', stage: 'encoding', progress: 99 });
  });

  it('reports lost_race when the job left running before completion (e.g. swept as stale)', async () => {
    const { store, deps } = setup(async (id) => {
      store.get(id).status = 'failed';
      return okResult;
    });
    const job = store.add(makeJob());
    expect(await processRenderMessage(deps, job.id)).toEqual({ type: 'ack', reason: 'lost_race' });
    expect(store.get(job.id).status).toBe('failed');
  });
});
