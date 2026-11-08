import { describe, expect, it, vi } from 'vitest';
import { toRenderJob } from '../../../src/server/job-state.ts';
import { assetPrefix } from '../../../src/server/job-state.ts';
import { failedCleanupKeys, metadataKeyFor, runSweep, type SweepDeps } from '../../../src/server/sweep.ts';
import { FakeJobStore, makeJob } from './fake-store.ts';

const NOW = new Date('2026-11-08T12:00:00.000Z');
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();
const MIN = 60 * 1000;

function setup(sendImpl: (id: string) => Promise<void> = async () => undefined) {
  const store = new FakeJobStore();
  const deleted: string[] = [];
  const send = vi.fn(sendImpl);
  const sendPoll = vi.fn(async (_id: string) => undefined);
  const destroyed: string[] = [];
  /** R2 の中身（キー一覧） */
  const objects = new Set<string>();
  const rows = () => [...store.rows.values()];
  const deps: SweepDeps = {
    now: () => NOW,
    findStaleQueued: async (before, limit) =>
      rows()
        .filter((r) => r.status === 'queued' && r.updatedAt < before)
        .slice(0, limit),
    touchQueued: (id, updatedAt) => store.updateIf(id, 'queued', { updatedAt }),
    send,
    findPollStalled: async (staleBefore, before, limit) =>
      rows()
        .filter((r) => r.status === 'running' && r.updatedAt < before && r.updatedAt >= staleBefore)
        .slice(0, limit),
    sendPoll,
    destroySandbox: async (id) => {
      destroyed.push(id);
    },
    failStaleRunning: async (before, patch, limit) => {
      const ids: string[] = [];
      for (const r of rows().filter((r) => r.status === 'running' && r.updatedAt < before).slice(0, limit)) {
        if (await store.updateIf(r.id, 'running', patch)) ids.push(r.id);
      }
      return ids;
    },
    findExpired: async (nowIso, limit) =>
      rows()
        .filter((r) => r.status === 'completed' && r.expired === 0 && r.expiresAt !== null && r.expiresAt <= nowIso)
        .slice(0, limit),
    deleteObjects: async (keys) => {
      deleted.push(...keys);
      for (const k of keys) objects.delete(k);
    },
    findFailedUncleaned: async (before, limit) =>
      rows()
        .filter((r) => r.status === 'failed' && r.expired === 0 && r.updatedAt < before)
        .slice(0, limit),
    listObjects: async (prefix) => ({ keys: [...objects].filter((k) => k.startsWith(prefix)), truncated: false }),
    markFailedCleaned: async (id) => {
      await store.updateIf(id, 'failed', { expired: 1, mp4Key: null, movKey: null });
    },
    markExpired: async (id, ts) => {
      await store.updateIf(id, 'completed', { expired: 1, updatedAt: ts });
    },
    log: vi.fn(),
  };
  return { store, deps, send, sendPoll, deleted, destroyed, objects };
}

describe('runSweep', () => {
  it('re-sends queued jobs older than 2 minutes and spaces out the next resend', async () => {
    const { store, deps, send } = setup();
    const old = store.add(makeJob({ updatedAt: ago(3 * MIN) }));
    const fresh = store.add(makeJob({ updatedAt: ago(30 * 1000) }));

    const report = await runSweep(deps);

    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(old.id);
    expect(report.resent).toBe(1);
    expect(store.get(old.id)).toMatchObject({ status: 'queued', updatedAt: NOW.toISOString() });
    expect(store.get(fresh.id).updatedAt).toBe(ago(30 * 1000));
  });

  it('keeps the job queued when the resend fails (picked up again next run)', async () => {
    const { store, deps } = setup(async () => {
      throw new Error('queue down');
    });
    const job = store.add(makeJob({ updatedAt: ago(10 * MIN) }));
    const report = await runSweep(deps);
    expect(report).toMatchObject({ resent: 0, resendFailed: 1 });
    expect(store.get(job.id).status).toBe('queued');
  });

  it('bounds the number of resends per run', async () => {
    const { store, deps, send } = setup();
    for (let i = 0; i < 5; i++) store.add(makeJob({ updatedAt: ago(10 * MIN) }));
    await runSweep(deps, 3);
    expect(send).toHaveBeenCalledTimes(3);
  });

  it('marks running jobs with no update for 20+ minutes as failed(stale) and leaves live ones', async () => {
    const { store, deps } = setup();
    const stale = store.add(makeJob({ status: 'running', updatedAt: ago(21 * MIN) }));
    const live = store.add(makeJob({ status: 'running', updatedAt: ago(5 * MIN) }));

    const report = await runSweep(deps);

    expect(report.staleFailed).toBe(1);
    expect(store.get(stale.id)).toMatchObject({ status: 'failed', errorCode: 'stale' });
    expect(toRenderJob(store.get(stale.id), NOW).error?.code).toBe('stale');
    expect(store.get(live.id).status).toBe('running');
  });

  it('destroys the sandbox of jobs failed as stale', async () => {
    const { store, deps, destroyed } = setup();
    const stale = store.add(makeJob({ status: 'running', updatedAt: ago(21 * MIN) }));
    await runSweep(deps);
    expect(destroyed).toEqual([stale.id]);
  });

  it('re-sends a poll for running jobs whose poll chain broke (2-20 min without update) only', async () => {
    const { store, deps, sendPoll } = setup();
    const broken = store.add(makeJob({ status: 'running', updatedAt: ago(3 * MIN) }));
    store.add(makeJob({ status: 'running', updatedAt: ago(30 * 1000) }));
    store.add(makeJob({ status: 'running', updatedAt: ago(25 * MIN) }));

    const report = await runSweep(deps);

    expect(sendPoll.mock.calls).toEqual([[broken.id]]);
    expect(report.pollResent).toBe(1);
    expect(store.get(broken.id).status).toBe('running');
  });

  it('cleans the R2 prefix of jobs failed over an hour ago and flags them cleaned (once)', async () => {
    const { store, deps, deleted, objects } = setup();
    const old = store.add(makeJob({ status: 'failed', errorCode: 'stale', updatedAt: ago(61 * MIN) }));
    const recent = store.add(makeJob({ status: 'failed', updatedAt: ago(10 * MIN) }));
    const done = store.add(makeJob({ status: 'completed', updatedAt: ago(2 * 60 * MIN), expiresAt: ago(-MIN) }));
    const oldPrefix = await assetPrefix(old.ownerId, old.id);
    const recentPrefix = await assetPrefix(recent.ownerId, recent.id);
    const donePrefix = await assetPrefix(done.ownerId, done.id);
    for (const p of [oldPrefix, recentPrefix, donePrefix]) {
      objects.add(`${p}preview.mp4`);
      objects.add(`${p}transparent.mov`);
    }
    objects.add(`${oldPrefix}metadata.json`);

    const report = await runSweep(deps);

    expect(report.failedCleaned).toBe(1);
    expect(deleted.sort()).toEqual([`${oldPrefix}metadata.json`, `${oldPrefix}preview.mp4`, `${oldPrefix}transparent.mov`]);
    expect(store.get(old.id)).toMatchObject({ status: 'failed', expired: 1, mp4Key: null, movKey: null });
    expect(toRenderJob(store.get(old.id), NOW)).toMatchObject({ status: 'failed', expired: false, error: { code: 'stale' } });
    expect(store.get(recent.id).expired).toBe(0);
    expect([...objects].filter((k) => k.startsWith(donePrefix))).toHaveLength(2);

    // 2 回目は対象外
    const again = await runSweep(deps);
    expect(again.failedCleaned).toBe(0);
  });

  it('does not flag a failed job cleaned while the listing is truncated', async () => {
    const { store, deps } = setup();
    const job = store.add(makeJob({ status: 'failed', updatedAt: ago(2 * 60 * MIN) }));
    deps.listObjects = async () => ({ keys: [], truncated: true });
    expect((await runSweep(deps)).failedCleaned).toBe(0);
    expect(store.get(job.id).expired).toBe(0);
  });

  it('deletes R2 objects of expired completed jobs and flags them expired', async () => {
    const { store, deps, deleted } = setup();
    const prefix = 'renders/0123456789abcdef/job';
    const expired = store.add(
      makeJob({
        status: 'completed',
        mp4Key: `${prefix}/preview.mp4`,
        movKey: `${prefix}/transparent.mov`,
        mp4Bytes: 1,
        movBytes: 2,
        expiresAt: ago(MIN),
      }),
    );
    const valid = store.add(
      makeJob({
        status: 'completed',
        mp4Key: 'renders/x/y/preview.mp4',
        movKey: 'renders/x/y/transparent.mov',
        expiresAt: new Date(NOW.getTime() + MIN).toISOString(),
      }),
    );

    const report = await runSweep(deps);

    expect(report.expired).toBe(1);
    expect(deleted).toEqual([`${prefix}/preview.mp4`, `${prefix}/transparent.mov`, `${prefix}/metadata.json`]);
    const dto = toRenderJob(store.get(expired.id), NOW);
    expect(dto).toMatchObject({ status: 'completed', expired: true, assets: null });
    expect(toRenderJob(store.get(valid.id), NOW).assets).not.toBeNull();
  });

  it('failedCleanupKeys unions recorded and listed keys but never leaves the job prefix', () => {
    const prefix = 'renders/abc/job-1/';
    expect(
      failedCleanupKeys(
        prefix,
        { mp4Key: `${prefix}preview.mp4`, movKey: null },
        [`${prefix}transparent.mov`, `${prefix}preview.mp4`, 'renders/abc/job-10/preview.mp4', 'renders/other/x', prefix],
      ).sort(),
    ).toEqual([`${prefix}metadata.json`, `${prefix}preview.mp4`, `${prefix}transparent.mov`]);
    expect(failedCleanupKeys('renders/abc/job-1', { mp4Key: null, movKey: null }, ['renders/abc/job-1/x'])).toEqual([]);
  });

  it('derives the metadata key from the mp4 key', () => {
    expect(metadataKeyFor('renders/a/b/preview.mp4')).toBe('renders/a/b/metadata.json');
  });
});
