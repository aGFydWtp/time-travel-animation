import { describe, expect, it, vi } from 'vitest';
import { toRenderJob } from '../../../src/server/job-state.ts';
import {
  decidePoll,
  isSandboxFileNotFound,
  precheckPoll,
  processPollMessage,
  processStartMessage,
  shouldDeleteAfterLostCompletion,
  type ProcessorDeps,
  type RenderBackend,
  type SandboxStatus,
} from '../../../src/server/render-processor.ts';
import { FakeJobStore, makeJob } from './fake-store.ts';

class FakeUsageLimit extends Error {
  override name = 'SandboxLimitError';
}

const T0 = new Date('2026-11-08T01:00:00.000Z');
const SEC = 1000;
const MIN = 60 * SEC;
const at = (ms: number) => new Date(T0.getTime() + ms);
const iso = (ms: number) => at(ms).toISOString();

const running = (status: Partial<SandboxStatus> = {}): SandboxStatus => ({
  result: { kind: 'missing' },
  progress: { kind: 'missing' },
  ...status,
});
const beat = (ms: number, stage = 'rendering', progress = 40) =>
  ({ kind: 'ok', value: { stage, progress, updatedAt: iso(ms) } }) as const;
const okResult = { kind: 'ok', value: { ok: true, totalFrames: 450 } } as const;

function setup() {
  const store = new FakeJobStore();
  let clock = T0;
  let status: SandboxStatus = running();
  const polls: { jobId: string; delay: number }[] = [];
  const deleted: string[] = [];
  const log = vi.fn();
  const backend = {
    launch: vi.fn<RenderBackend['launch']>(async () => undefined),
    readStatus: vi.fn<RenderBackend['readStatus']>(async () => status),
    upload: vi.fn<RenderBackend['upload']>(async () => ({ mp4Bytes: 1234, movBytes: 98765 })),
    destroy: vi.fn<RenderBackend['destroy']>(async () => undefined),
  };
  const deps: ProcessorDeps = {
    now: () => clock,
    getJob: async (id) => store.find(id),
    claim: (id, patch) => store.claim(id, patch),
    update: (id, patch, opts) => store.updateIf(id, 'running', patch, opts),
    enqueuePoll: vi.fn(async (jobId: string, delay: number) => {
      polls.push({ jobId, delay });
    }),
    backend,
    deleteObjects: vi.fn(async (keys: string[]) => {
      deleted.push(...keys);
    }),
    isUsageLimit: (err) => err instanceof FakeUsageLimit,
    retentionDays: 30,
    log,
  };
  return {
    store,
    deps,
    backend,
    polls,
    deleted,
    log,
    setClock: (ms: number) => (clock = at(ms)),
    setStatus: (s: SandboxStatus) => (status = s),
  };
}

/** start を処理し、10 秒後の poll を投げられる状態にする */
async function started() {
  const t = setup();
  const job = t.store.add(makeJob({}, at(-MIN)));
  expect(await processStartMessage(t.deps, job.id)).toEqual({ type: 'ack', reason: 'started' });
  return { ...t, job };
}

describe('processStartMessage', () => {
  it('claims, launches the render in the background and schedules a poll in 10s', async () => {
    const { store, backend, polls, job } = await started();
    expect(backend.launch).toHaveBeenCalledTimes(1);
    expect(backend.launch.mock.calls[0]![0]).toBe(job.id);
    expect(polls).toEqual([{ jobId: job.id, delay: 10 }]);
    expect(store.get(job.id)).toMatchObject({ status: 'running', stage: 'starting', attempt: 1, startedAt: T0.toISOString() });
  });

  it('does not launch twice on redelivery; re-schedules a poll for a running job instead', async () => {
    const { deps, backend, polls, job } = await started();
    expect(await processStartMessage(deps, job.id)).toEqual({ type: 'ack', reason: 'duplicate' });
    expect(backend.launch).toHaveBeenCalledTimes(1);
    expect(polls).toHaveLength(2);
  });

  it('acks unknown / finished jobs without launching or polling', async () => {
    const { store, deps, backend, polls } = setup();
    const done = store.add(makeJob({ status: 'completed' }));
    expect(await processStartMessage(deps, done.id)).toEqual({ type: 'ack', reason: 'duplicate' });
    expect(await processStartMessage(deps, '00000000-0000-4000-8000-ffffffffffff')).toEqual({
      type: 'ack',
      reason: 'duplicate',
    });
    expect(backend.launch).not.toHaveBeenCalled();
    expect(polls).toHaveLength(0);
  });

  it('propagates a poll send failure so the start message is retried (and then only polls)', async () => {
    const { store, deps, backend } = setup();
    const job = store.add(makeJob());
    deps.enqueuePoll = vi.fn(async () => {
      throw new Error('queue down');
    });
    await expect(processStartMessage(deps, job.id)).rejects.toThrow('queue down');
    expect(store.get(job.id).status).toBe('running');

    deps.enqueuePoll = vi.fn(async () => undefined);
    expect(await processStartMessage(deps, job.id)).toEqual({ type: 'ack', reason: 'duplicate' });
    expect(deps.enqueuePoll).toHaveBeenCalledTimes(1);
    expect(backend.launch).toHaveBeenCalledTimes(1);
  });

  it('requeues on a sandbox usage limit and asks the queue to retry in 60s', async () => {
    const { store, deps, backend, polls } = setup();
    const job = store.add(makeJob());
    backend.launch.mockRejectedValueOnce(new FakeUsageLimit('concurrency'));

    expect(await processStartMessage(deps, job.id)).toEqual({ type: 'retry', delaySeconds: 60 });
    expect(store.get(job.id)).toMatchObject({ status: 'queued', stage: 'queued', attempt: 0, startedAt: null });
    expect(polls).toHaveLength(0);

    // 再配信で再び claim できる
    expect(await processStartMessage(deps, job.id)).toEqual({ type: 'ack', reason: 'started' });
    expect(store.get(job.id).attempt).toBe(1);
  });

  it('fails as sandbox_unavailable (not stuck in running) when the launch throws, and destroys the sandbox', async () => {
    const { store, deps, backend } = setup();
    const job = store.add(makeJob());
    backend.launch.mockRejectedValueOnce(new Error('binding SANDBOX not found\n    at stack frame'));

    expect(await processStartMessage(deps, job.id)).toEqual({ type: 'ack', reason: 'failed' });
    expect(store.get(job.id)).toMatchObject({ status: 'failed', errorCode: 'sandbox_unavailable' });
    expect(store.get(job.id).errorMessage).not.toContain('stack');
    expect(backend.destroy).toHaveBeenCalledWith(job.id);
  });

  it('fails with invalid_config when the stored config no longer validates', async () => {
    const { store, deps, backend } = setup();
    const job = store.add(makeJob({ configJson: JSON.stringify({ fps: 999 }) }));
    await processStartMessage(deps, job.id);
    expect(backend.launch).not.toHaveBeenCalled();
    expect(store.get(job.id)).toMatchObject({ status: 'failed', errorCode: 'invalid_config' });
  });
});

describe('processPollMessage', () => {
  it('maps container progress, refreshes updated_at and re-schedules itself', async () => {
    const { store, deps, polls, setClock, setStatus, job } = await started();
    setClock(10 * SEC);
    setStatus(running({ progress: beat(9 * SEC, 'encoding_mov', 100) }));

    expect(await processPollMessage(deps, job.id)).toEqual({ type: 'ack', reason: 'polling' });
    // 100 は completed でだけ付ける
    expect(store.get(job.id)).toMatchObject({ status: 'running', stage: 'encoding', progress: 95, updatedAt: iso(10 * SEC) });
    expect(polls).toHaveLength(2);
  });

  it('runs a long render across many short poll invocations, then uploads once and completes', async () => {
    const { store, deps, backend, polls, setClock, setStatus, job } = await started();
    // 30 分（15 分の consumer 上限を大きく超える）描画し続ける
    let t = 0;
    for (let i = 0; i < 180; i++) {
      t += 10 * SEC;
      setClock(t);
      setStatus(running({ progress: beat(t - 2 * SEC, 'rendering', (i / 180) * 60) }));
      expect(await processPollMessage(deps, job.id)).toEqual({ type: 'ack', reason: 'polling' });
    }
    t += 10 * SEC;
    setClock(t);
    setStatus(running({ result: okResult, progress: beat(t - SEC, 'done', 100) }));

    expect(await processPollMessage(deps, job.id)).toEqual({ type: 'ack', reason: 'completed' });
    expect(backend.upload).toHaveBeenCalledTimes(1);
    expect(backend.destroy).toHaveBeenCalledWith(job.id);
    const row = store.get(job.id);
    expect(row).toMatchObject({ status: 'completed', stage: 'done', progress: 100, mp4Bytes: 1234, movBytes: 98765 });
    expect(row.mp4Key).toMatch(new RegExp(`^renders/[0-9a-f]{16}/${job.id}/preview\\.mp4$`));
    expect(row.mp4Key).not.toContain('owner@example.com');
    expect(toRenderJob(row, at(t)).assets?.mp4.url).toBe(`/api/renders/${job.id}/assets/mp4`);
    expect(polls).toHaveLength(181); // start の 1 回 + 180 回の再送。完了時は送らない
  });

  it('lets only one of two concurrent polls take the upload', async () => {
    const { store, deps, backend, setClock, setStatus, job } = await started();
    setClock(20 * SEC);
    setStatus(running({ result: okResult }));
    let release!: () => void;
    backend.upload.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () => resolve({ mp4Bytes: 1, movBytes: 2 });
        }),
    );
    const first = processPollMessage(deps, job.id);
    await vi.waitFor(() => expect(backend.upload).toHaveBeenCalledTimes(1));
    // 2 本目の poll（重複連鎖 / cron の再送）はアップロード中なので何もしない
    expect(await processPollMessage(deps, job.id)).toEqual({ type: 'ack', reason: 'upload_in_progress' });
    release();
    expect(await first).toEqual({ type: 'ack', reason: 'completed' });
    expect(backend.upload).toHaveBeenCalledTimes(1);
    expect(store.get(job.id).status).toBe('completed');
  });

  it('stops a duplicate poll chain that runs right after another poll', async () => {
    const { deps, backend, polls, setClock, setStatus, job } = await started();
    setClock(10 * SEC);
    setStatus(running({ progress: beat(9 * SEC) }));
    await processPollMessage(deps, job.id);
    setClock(13 * SEC); // 3 秒後に別連鎖の poll
    expect(await processPollMessage(deps, job.id)).toEqual({ type: 'ack', reason: 'duplicate_chain' });
    expect(backend.readStatus).toHaveBeenCalledTimes(1);
    expect(polls).toHaveLength(2);
  });

  it('acks polls for jobs that are no longer running', async () => {
    const { store, deps, backend, polls } = setup();
    const job = store.add(makeJob({ status: 'failed' }));
    expect(await processPollMessage(deps, job.id)).toEqual({ type: 'ack', reason: 'not_running' });
    expect(backend.readStatus).not.toHaveBeenCalled();
    expect(polls).toHaveLength(0);
  });

  it('fails with the mapped, sanitized code when the container reports an error, and destroys the sandbox', async () => {
    const { store, deps, backend, polls, setClock, setStatus, job } = await started();
    setClock(20 * SEC);
    setStatus(
      running({
        result: { kind: 'ok', value: { ok: false, errorCode: 'ENCODE_MOV_FAILED', message: 'ffmpeg /work/secret failed' } },
      }),
    );
    expect(await processPollMessage(deps, job.id)).toEqual({ type: 'ack', reason: 'failed' });
    const row = store.get(job.id);
    expect(row).toMatchObject({ status: 'failed', errorCode: 'encode_failed' });
    expect(row.errorMessage).not.toContain('/work');
    expect(toRenderJob(row, at(20 * SEC)).error?.code).toBe('encode_failed');
    expect(backend.destroy).toHaveBeenCalledWith(job.id);
    expect(polls).toHaveLength(1);
  });

  it('fails as stalled when the heartbeat stops (container process died)', async () => {
    const { store, deps, setClock, setStatus, job } = await started();
    setClock(10 * MIN);
    setStatus(running({ progress: beat(6 * MIN) }));
    expect(await processPollMessage(deps, job.id)).toEqual({ type: 'ack', reason: 'failed' });
    expect(store.get(job.id)).toMatchObject({ status: 'failed', errorCode: 'stalled' });
  });

  it('fails as container_lost when progress.json never appears after the start grace', async () => {
    const { store, deps, polls, setClock, job } = await started();
    setClock(2 * MIN);
    expect(await processPollMessage(deps, job.id)).toEqual({ type: 'ack', reason: 'polling' });
    setClock(4 * MIN);
    expect(await processPollMessage(deps, job.id)).toEqual({ type: 'ack', reason: 'failed' });
    expect(store.get(job.id)).toMatchObject({ status: 'failed', errorCode: 'container_lost' });
    expect(polls).toHaveLength(2);
  });

  it('keeps polling without writing on a transient read error', async () => {
    const { store, deps, backend, polls, setClock, job } = await started();
    const before = store.get(job.id).updatedAt;
    setClock(30 * SEC);
    backend.readStatus.mockRejectedValueOnce(new Error('sandbox rpc reset'));
    expect(await processPollMessage(deps, job.id)).toEqual({ type: 'ack', reason: 'polling' });
    expect(store.get(job.id)).toMatchObject({ status: 'running', updatedAt: before });
    expect(polls).toHaveLength(2);
  });

  it('fails as upload_failed and deletes partial objects when the upload throws', async () => {
    const { store, deps, backend, deleted, setClock, setStatus, job } = await started();
    setClock(20 * SEC);
    setStatus(running({ result: okResult }));
    backend.upload.mockRejectedValueOnce(new Error('R2 500'));
    expect(await processPollMessage(deps, job.id)).toEqual({ type: 'ack', reason: 'failed' });
    expect(store.get(job.id)).toMatchObject({ status: 'failed', errorCode: 'upload_failed' });
    expect(deleted).toHaveLength(3);
    expect(deleted.every((k) => k.includes(job.id))).toBe(true);
  });

  it('fails as timeout when the upload exceeds its deadline', async () => {
    const { store, deps, backend, setClock, setStatus, job } = await started();
    deps.uploadDeadlineMs = 20;
    setClock(20 * SEC);
    setStatus(running({ result: okResult }));
    backend.upload.mockImplementationOnce(() => new Promise(() => undefined));
    expect(await processPollMessage(deps, job.id)).toEqual({ type: 'ack', reason: 'failed' });
    expect(store.get(job.id)).toMatchObject({ status: 'failed', errorCode: 'timeout' });
  });

  it('deletes the uploaded objects when the job was failed (e.g. swept as stale) during the upload', async () => {
    const { store, deps, backend, deleted, setClock, setStatus, job } = await started();
    setClock(20 * SEC);
    setStatus(running({ result: okResult }));
    backend.upload.mockImplementationOnce(async () => {
      store.get(job.id).status = 'failed';
      return { mp4Bytes: 1, movBytes: 2 };
    });
    expect(await processPollMessage(deps, job.id)).toEqual({ type: 'ack', reason: 'lost_race' });
    expect(store.get(job.id).status).toBe('failed');
    expect(deleted).toHaveLength(3);
  });

  it('keeps the objects when another poll already completed the job', async () => {
    const { store, deps, backend, deleted, setClock, setStatus, job } = await started();
    setClock(20 * SEC);
    setStatus(running({ result: okResult }));
    backend.upload.mockImplementationOnce(async () => {
      store.get(job.id).status = 'completed';
      return { mp4Bytes: 1, movBytes: 2 };
    });
    expect(await processPollMessage(deps, job.id)).toEqual({ type: 'ack', reason: 'lost_race' });
    expect(deleted).toHaveLength(0);
  });
});

describe('precheckPoll', () => {
  const row = (over: { status?: string; stage?: string | null; updatedAt?: string } = {}) => ({
    status: 'running',
    stage: 'rendering_frames',
    updatedAt: iso(0),
    ...over,
  });

  it('continues when the last update is at least 5 s old', () => {
    expect(precheckPoll(row(), at(10 * SEC))).toEqual({ kind: 'continue' });
    expect(precheckPoll(row(), at(4 * SEC))).toEqual({ kind: 'stop', reason: 'duplicate_chain' });
  });

  it('waits for an active upload and takes it over after the 12-minute lease', () => {
    expect(precheckPoll(row({ stage: 'uploading' }), at(11 * MIN))).toEqual({ kind: 'stop', reason: 'upload_in_progress' });
    expect(precheckPoll(row({ stage: 'uploading' }), at(13 * MIN))).toEqual({ kind: 'continue' });
  });

  it('stops for missing or non-running jobs', () => {
    expect(precheckPoll(null, at(0))).toEqual({ kind: 'stop', reason: 'not_running' });
    expect(precheckPoll(row({ status: 'completed' }), at(MIN))).toEqual({ kind: 'stop', reason: 'not_running' });
  });
});

describe('decidePoll', () => {
  const decide = (nowMs: number, status: SandboxStatus) => decidePoll({ startedAt: iso(0), now: at(nowMs), status });

  it('fails as timeout after 2 hours even with a live heartbeat', () => {
    expect(decide(2 * 60 * MIN + SEC, running({ progress: beat(2 * 60 * MIN) }))).toMatchObject({
      kind: 'fail',
      code: 'timeout',
    });
  });

  it('uploads only on result ok:true; malformed results are invalid_output', () => {
    expect(decide(MIN, running({ result: okResult })).kind).toBe('upload');
    expect(decide(MIN, running({ result: { kind: 'ok', value: { ok: 'yes' } } }))).toMatchObject({
      kind: 'fail',
      code: 'invalid_output',
    });
  });

  it('treats read errors as transient', () => {
    expect(decide(MIN, running({ result: { kind: 'error', detail: 'x' } })).kind).toBe('transient');
    expect(decide(MIN, running({ progress: { kind: 'error', detail: 'x' } })).kind).toBe('transient');
  });

  it('only touches updated_at while progress.json has not appeared yet within the grace period', () => {
    const d = decide(MIN, running());
    expect(d).toEqual({ kind: 'progress', patch: { updatedAt: iso(MIN) } });
  });

  it('accepts a heartbeat up to 3 minutes old and treats a missing updatedAt as no heartbeat', () => {
    expect(decide(10 * MIN, running({ progress: beat(7 * MIN + SEC) })).kind).toBe('progress');
    expect(decide(10 * MIN, running({ progress: { kind: 'ok', value: { stage: 'rendering', progress: 1 } } }))).toMatchObject(
      { kind: 'fail', code: 'stalled' },
    );
  });
});

describe('shouldDeleteAfterLostCompletion', () => {
  it('deletes unless the job ended up completed', () => {
    expect(shouldDeleteAfterLostCompletion({ status: 'failed' })).toBe(true);
    expect(shouldDeleteAfterLostCompletion(null)).toBe(true);
    expect(shouldDeleteAfterLostCompletion({ status: 'completed' })).toBe(false);
  });
});

describe('isSandboxFileNotFound', () => {
  it('recognizes ENOENT both as the SDK error and as the message it becomes across RPC', () => {
    const sdk = Object.assign(new Error('missing'), { name: 'SandboxFileError', code: 'ENOENT' });
    expect(isSandboxFileNotFound(sdk)).toBe(true);
    expect(
      isSandboxFileNotFound(
        new Error("SandboxFileError: readFile '/workspace/jobs/x/out/result.json': No such file or directory (os error 2)"),
      ),
    ).toBe(true);
  });

  it('treats other failures as transient', () => {
    expect(isSandboxFileNotFound(new Error('SandboxFileError: readFile x: Permission denied (os error 13)'))).toBe(false);
    expect(isSandboxFileNotFound(new Error('No such file or directory'))).toBe(false);
    expect(isSandboxFileNotFound(new Error('Network connection lost'))).toBe(false);
    expect(isSandboxFileNotFound('ENOENT')).toBe(false);
  });
});
