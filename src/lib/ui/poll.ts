// Job polling cadence (design.md: 2s, exponential backoff up to 10s).
import type { RenderJob } from '../api/types.ts';

export const POLL_MIN_MS = 2000;
export const POLL_MAX_MS = 10_000;
export const POLL_FACTOR = 1.5;

/** Reset to the base interval whenever something changed; otherwise back off. */
export function nextPollDelay(previousMs: number, changed: boolean): number {
  if (changed) return POLL_MIN_MS;
  const base = Number.isFinite(previousMs) ? Math.max(previousMs, POLL_MIN_MS) : POLL_MIN_MS;
  return Math.min(Math.round(base * POLL_FACTOR), POLL_MAX_MS);
}

export function isActiveJob(job: Pick<RenderJob, 'status'>): boolean {
  return job.status === 'queued' || job.status === 'running';
}

/** Whether a polled job differs in anything the UI shows. */
export function jobChanged(before: RenderJob | undefined, after: RenderJob): boolean {
  if (!before) return true;
  return (
    before.status !== after.status ||
    before.stage !== after.stage ||
    before.progress !== after.progress ||
    before.updatedAt !== after.updatedAt ||
    before.expired !== after.expired
  );
}

/** Merge fetched jobs into the current list (fetched wins), newest first. */
export function mergeJobs(existing: readonly RenderJob[], incoming: readonly RenderJob[]): RenderJob[] {
  const byId = new Map<string, RenderJob>();
  for (const job of existing) byId.set(job.id, job);
  for (const job of incoming) byId.set(job.id, job);
  return [...byId.values()].sort((a, b) => {
    if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? 1 : -1;
    return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
  });
}
