// 定期掃除（crons/sweep.ts から呼ぶ）。Void API は deps として注入する。
import { REQUEUE_AFTER_MS, STALE_RUNNING_MS, SWEEP_BATCH_SIZE } from './constants.ts';
import { errorSummary, logEvent } from './log.ts';
import { failedPatch, type JobRow } from './job-state.ts';

export interface SweepDeps {
  now(): Date;
  /** status=queued かつ updated_at < before（古い順, limit 件） */
  findStaleQueued(before: string, limit: number): Promise<Pick<JobRow, 'id'>[]>;
  /** CAS: queued のままなら updated_at を進める（再送の間隔を空ける）。更新できたら true */
  touchQueued(jobId: string, updatedAt: string): Promise<boolean>;
  send(jobId: string): Promise<void>;
  /** CAS: status=running かつ updated_at < before を failed に。更新した id を返す */
  failStaleRunning(before: string, patch: ReturnType<typeof failedPatch>, limit: number): Promise<string[]>;
  /** status=completed, expired=0, expires_at <= now */
  findExpired(now: string, limit: number): Promise<Pick<JobRow, 'id' | 'mp4Key' | 'movKey'>[]>;
  deleteObjects(keys: string[]): Promise<void>;
  markExpired(jobId: string, updatedAt: string): Promise<void>;
  log?: typeof logEvent;
}

export interface SweepReport {
  resent: number;
  resendFailed: number;
  staleFailed: number;
  expired: number;
}

export function metadataKeyFor(mp4Key: string): string {
  return mp4Key.replace(/[^/]+$/, 'metadata.json');
}

export async function runSweep(deps: SweepDeps, batchSize = SWEEP_BATCH_SIZE): Promise<SweepReport> {
  const log = deps.log ?? logEvent;
  const now = deps.now();
  const nowIso = now.toISOString();
  const report: SweepReport = { resent: 0, resendFailed: 0, staleFailed: 0, expired: 0 };

  // 1) Queue 送信に失敗して取り残された queued を再送（重複は consumer の CAS で吸収）
  const requeueBefore = new Date(now.getTime() - REQUEUE_AFTER_MS).toISOString();
  for (const job of await deps.findStaleQueued(requeueBefore, batchSize)) {
    if (!(await deps.touchQueued(job.id, nowIso))) continue;
    try {
      await deps.send(job.id);
      report.resent++;
      log('sweep.resent', { jobId: job.id });
    } catch (err) {
      report.resendFailed++;
      log('sweep.resend_failed', { jobId: job.id, error: errorSummary(err) });
    }
  }

  // 2) running のまま止まったジョブ（コンテナ停止・consumer 打ち切り）を failed(stale) に
  const staleBefore = new Date(now.getTime() - STALE_RUNNING_MS).toISOString();
  const staleIds = await deps.failStaleRunning(staleBefore, failedPatch('stale', now), batchSize);
  report.staleFailed = staleIds.length;
  for (const id of staleIds) log('sweep.stale_failed', { jobId: id });

  // 3) 保持期限切れの成果物を削除し、DB に expired を立てる
  for (const job of await deps.findExpired(nowIso, batchSize)) {
    const keys = [job.mp4Key, job.movKey].filter((k): k is string => !!k);
    if (job.mp4Key) keys.push(metadataKeyFor(job.mp4Key));
    try {
      if (keys.length) await deps.deleteObjects(keys);
      await deps.markExpired(job.id, nowIso);
      report.expired++;
      log('sweep.expired', { jobId: job.id, objects: keys.length });
    } catch (err) {
      log('sweep.expire_failed', { jobId: job.id, error: errorSummary(err) });
    }
  }

  log('sweep.done', { ...report });
  return report;
}
