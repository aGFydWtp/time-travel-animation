import { describe, expect, it } from 'vitest';
import type { RenderJob } from '../api/types.ts';
import { DEFAULT_CONFIG } from '../renderer/types.ts';
import { POLL_MAX_MS, POLL_MIN_MS, isActiveJob, jobChanged, mergeJobs, nextPollDelay } from './poll.ts';

function job(overrides: Partial<RenderJob> = {}): RenderJob {
  return {
    id: 'job-1',
    status: 'queued',
    stage: 'queued',
    progress: 0,
    attempt: 1,
    config: { ...DEFAULT_CONFIG },
    configHash: 'abc',
    createdAt: '2026-11-08T00:00:00.000Z',
    updatedAt: '2026-11-08T00:00:00.000Z',
    startedAt: null,
    completedAt: null,
    expiresAt: null,
    expired: false,
    error: null,
    assets: null,
    ...overrides,
  };
}

describe('nextPollDelay', () => {
  it('backs off from 2s up to a 10s cap while nothing changes', () => {
    const delays: number[] = [];
    let d = POLL_MIN_MS;
    for (let i = 0; i < 8; i++) {
      d = nextPollDelay(d, false);
      delays.push(d);
    }
    expect(delays[0]).toBe(3000);
    expect(delays).toEqual([...delays].sort((a, b) => a - b));
    expect(Math.max(...delays)).toBe(POLL_MAX_MS);
    expect(delays.at(-1)).toBe(POLL_MAX_MS);
  });

  it('resets to 2s on change', () => {
    expect(nextPollDelay(POLL_MAX_MS, true)).toBe(POLL_MIN_MS);
  });

  it('never drops below the base interval for bad input', () => {
    expect(nextPollDelay(Number.NaN, false)).toBe(3000);
    expect(nextPollDelay(0, false)).toBe(3000);
  });
});

describe('isActiveJob', () => {
  it('queued and running are active', () => {
    expect(isActiveJob({ status: 'queued' })).toBe(true);
    expect(isActiveJob({ status: 'running' })).toBe(true);
    expect(isActiveJob({ status: 'completed' })).toBe(false);
    expect(isActiveJob({ status: 'failed' })).toBe(false);
  });
});

describe('jobChanged', () => {
  it('detects progress/stage/status changes', () => {
    const a = job();
    expect(jobChanged(undefined, a)).toBe(true);
    expect(jobChanged(a, job())).toBe(false);
    expect(jobChanged(a, job({ progress: 10 }))).toBe(true);
    expect(jobChanged(a, job({ stage: 'starting' }))).toBe(true);
    expect(jobChanged(a, job({ status: 'running' }))).toBe(true);
  });
});

describe('mergeJobs', () => {
  it('replaces by id and sorts newest first', () => {
    const old = job({ id: 'a', createdAt: '2026-11-07T00:00:00.000Z' });
    const mid = job({ id: 'b', createdAt: '2026-11-08T00:00:00.000Z' });
    const updatedMid = { ...mid, status: 'running' as const };
    const fresh = job({ id: 'c', createdAt: '2026-11-08T01:00:00.000Z' });
    const merged = mergeJobs([mid, old], [updatedMid, fresh]);
    expect(merged.map((j) => j.id)).toEqual(['c', 'b', 'a']);
    expect(merged[1]?.status).toBe('running');
  });
});
