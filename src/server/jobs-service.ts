// ジョブ作成（POST /api/renders と retry で共有）と Queue 送信。
import { queues } from 'void/queues';
import type { CreateRenderResponse } from '../lib/api/types.ts';
import { canonicalConfigString, hashConfig, type RenderConfig } from '../lib/renderer/index.ts';
import { ACTIVE_JOB_LIMIT, HOUR_MS, HOURLY_JOB_LIMIT } from './constants.ts';
import { ApiError } from './errors.ts';
import { decideCreate, newJobValues, type JobRow } from './job-state.ts';
import {
  countCreatedSince,
  findActiveJobs,
  findByIdempotencyKey,
  insertJobIfBelowActiveLimit,
} from './jobs-repo.ts';
import { errorSummary, logEvent } from './log.ts';

export interface CreateResult {
  status: 200 | 202;
  body: CreateRenderResponse;
}

/** Queue へ送る。失敗してもジョブは queued のまま残し、cron（sweep）が再送する。 */
export async function enqueueRender(jobId: string): Promise<boolean> {
  try {
    await queues.render.send({ type: 'start', jobId });
    logEvent('render.enqueued', { jobId });
    return true;
  } catch (err) {
    logEvent('render.enqueue_failed', { jobId, error: errorSummary(err) });
    return false;
  }
}

/** poll メッセージを遅延送信する。失敗は例外のまま返す（consumer がメッセージを再配信させる / cron が再送する） */
export async function enqueuePoll(jobId: string, delaySeconds: number, launchedAt?: string): Promise<void> {
  await queues.render.send(launchedAt ? { type: 'poll', jobId, launchedAt } : { type: 'poll', jobId }, { delaySeconds });
}

async function decide(ownerId: string, configHash: string, idempotencyKey: string | null, now: Date) {
  const [idempotent, active, recentCount] = await Promise.all([
    idempotencyKey ? findByIdempotencyKey(ownerId, idempotencyKey) : Promise.resolve(null),
    findActiveJobs(ownerId),
    countCreatedSince(ownerId, new Date(now.getTime() - HOUR_MS).toISOString()),
  ]);
  return decideCreate({
    idempotent,
    active,
    configHash,
    recentCount,
    activeLimit: ACTIVE_JOB_LIMIT,
    hourlyLimit: HOURLY_JOB_LIMIT,
  });
}

function reused(job: Pick<JobRow, 'id' | 'status'>): CreateResult {
  return { status: 200, body: { id: job.id, status: job.status as CreateRenderResponse['status'], reused: true } };
}

function isUniqueViolation(err: unknown): boolean {
  const msg = err instanceof Error ? `${err.message} ${String((err as { cause?: unknown }).cause ?? '')}` : '';
  return /UNIQUE constraint failed/i.test(msg);
}

/** `config` は検証・正規化済みであること。 */
export async function createRenderJob(
  ownerId: string,
  config: RenderConfig,
  idempotencyKey: string | null,
): Promise<CreateResult> {
  const now = new Date();
  const configHash = await hashConfig(config);
  const configJson = canonicalConfigString(config);

  const decision = await decide(ownerId, configHash, idempotencyKey, now);
  if (decision.kind === 'reuse') return reused(decision.job);
  if (decision.kind === 'rate_limited') {
    throw new ApiError(429, 'rate_limited', decision.message, { headers: { 'retry-after': '30' } });
  }

  const row = newJobValues({ id: crypto.randomUUID(), ownerId, configJson, configHash, idempotencyKey, now });
  let inserted: boolean;
  try {
    inserted = await insertJobIfBelowActiveLimit(row, ACTIVE_JOB_LIMIT);
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
    inserted = false; // 同じ idempotencyKey の同時リクエストに負けた
  }

  if (!inserted) {
    // 判定と挿入の間に別リクエストがジョブを作った。最新状態で判定し直す
    const again = await decide(ownerId, configHash, idempotencyKey, now);
    if (again.kind === 'reuse') return reused(again.job);
    throw new ApiError(429, 'rate_limited', '進行中の書き出しが終わるまでお待ちください', {
      headers: { 'retry-after': '30' },
    });
  }

  logEvent('render.created', { jobId: row.id, configHash });
  await enqueueRender(row.id);
  return { status: 202, body: { id: row.id, status: 'queued', reused: false } };
}
