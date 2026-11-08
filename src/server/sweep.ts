// 定期掃除（crons/sweep.ts から呼ぶ）。Void API は deps として注入する。
import {
  FAILED_CLEANUP_AFTER_MS,
  POLL_RESEND_AFTER_MS,
  REQUEUE_AFTER_MS,
  STALE_RUNNING_MS,
  SWEEP_BATCH_SIZE,
} from './constants.ts';
import { errorSummary, logEvent } from './log.ts';
import { assetPrefix, failedPatch, type JobRow } from './job-state.ts';

export interface SweepDeps {
  now(): Date;
  /** status=queued かつ updated_at < before（古い順, limit 件） */
  findStaleQueued(before: string, limit: number): Promise<Pick<JobRow, 'id'>[]>;
  /** CAS: queued のままなら updated_at を進める（再送の間隔を空ける）。更新できたら true */
  touchQueued(jobId: string, updatedAt: string): Promise<boolean>;
  /** start メッセージを送る */
  send(jobId: string): Promise<void>;
  /** status=running かつ staleBefore <= updated_at < before（poll 連鎖が切れたかもしれない） */
  findPollStalled(staleBefore: string, before: string, limit: number): Promise<Pick<JobRow, 'id'>[]>;
  /** poll メッセージを送る（重複した連鎖は consumer 側で 1 本に収束する） */
  sendPoll(jobId: string): Promise<void>;
  /** CAS: status=running かつ updated_at < before を failed に。更新した id を返す */
  failStaleRunning(before: string, patch: ReturnType<typeof failedPatch>, limit: number): Promise<string[]>;
  /** stale で failed にしたジョブの Sandbox を止める（描画プロセスが残っていても止める） */
  destroySandbox(jobId: string): Promise<void>;
  /** status=completed, expired=0, expires_at <= now */
  findExpired(now: string, limit: number): Promise<Pick<JobRow, 'id' | 'mp4Key' | 'movKey'>[]>;
  deleteObjects(keys: string[]): Promise<void>;
  markExpired(jobId: string, updatedAt: string): Promise<void>;
  /** status=failed, expired=0, updated_at < before */
  findFailedUncleaned(before: string, limit: number): Promise<Pick<JobRow, 'id' | 'ownerId' | 'mp4Key' | 'movKey'>[]>;
  /** prefix 配下のキー（1 回の list。truncated なら続きがある） */
  listObjects(prefix: string): Promise<{ keys: string[]; truncated: boolean }>;
  /** failed の R2 掃除済みを記録（キー列を空にする） */
  markFailedCleaned(jobId: string): Promise<void>;
  log?: typeof logEvent;
}

export interface SweepReport {
  resent: number;
  resendFailed: number;
  pollResent: number;
  staleFailed: number;
  expired: number;
  failedCleaned: number;
}

export function metadataKeyFor(mp4Key: string): string {
  return mp4Key.replace(/[^/]+$/, 'metadata.json');
}

/**
 * failed ジョブで消すキー: 記録済みのキー（+ metadata）と prefix の list 結果の和集合。
 * 安全のため、そのジョブの prefix 配下以外は決して消さない。
 */
export function failedCleanupKeys(
  prefix: string,
  job: Pick<JobRow, 'mp4Key' | 'movKey'>,
  listed: readonly string[],
): string[] {
  const keys = new Set<string>();
  for (const k of [job.mp4Key, job.movKey]) if (k) keys.add(k);
  if (job.mp4Key) keys.add(metadataKeyFor(job.mp4Key));
  for (const k of listed) keys.add(k);
  return [...keys].filter((k) => prefix.endsWith('/') && k.startsWith(prefix) && k.length > prefix.length);
}

export async function runSweep(deps: SweepDeps, batchSize = SWEEP_BATCH_SIZE): Promise<SweepReport> {
  const log = deps.log ?? logEvent;
  const now = deps.now();
  const nowIso = now.toISOString();
  const report: SweepReport = { resent: 0, resendFailed: 0, pollResent: 0, staleFailed: 0, expired: 0, failedCleaned: 0 };
  const ago = (ms: number) => new Date(now.getTime() - ms).toISOString();

  // 1) Queue 送信に失敗して取り残された queued を再送（重複は consumer の CAS で吸収）
  for (const job of await deps.findStaleQueued(ago(REQUEUE_AFTER_MS), batchSize)) {
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

  // 2) poll 連鎖が切れた running に poll を再送（updated_at は触らない。poll が生きていれば次の更新で外れる）
  const staleBefore = ago(STALE_RUNNING_MS);
  for (const job of await deps.findPollStalled(staleBefore, ago(POLL_RESEND_AFTER_MS), batchSize)) {
    try {
      await deps.sendPoll(job.id);
      report.pollResent++;
      log('sweep.poll_resent', { jobId: job.id });
    } catch (err) {
      log('sweep.poll_resend_failed', { jobId: job.id, error: errorSummary(err) });
    }
  }

  // 3) running のまま止まったジョブ（poll も届かない）を failed(stale) にし、Sandbox を止める
  const staleIds = await deps.failStaleRunning(staleBefore, failedPatch('stale', now), batchSize);
  report.staleFailed = staleIds.length;
  for (const id of staleIds) {
    log('sweep.stale_failed', { jobId: id });
    await deps.destroySandbox(id).catch((err: unknown) => {
      log('sweep.sandbox_destroy_failed', { jobId: id, error: errorSummary(err) });
    });
  }

  // 4) 保持期限切れの成果物を削除し、DB に expired を立てる
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

  // 5) failed になって時間が経ったジョブの R2 プレフィックスを掃除する
  //    （completed の CAS に負けた / 削除に失敗した / 期限超過後に遅れて届いた put の取りこぼし）
  for (const job of await deps.findFailedUncleaned(ago(FAILED_CLEANUP_AFTER_MS), batchSize)) {
    try {
      const prefix = await assetPrefix(job.ownerId, job.id);
      const listed = await deps.listObjects(prefix);
      const keys = failedCleanupKeys(prefix, job, listed.keys);
      if (keys.length) await deps.deleteObjects(keys);
      // list が切り詰められていたら印を付けず、次回の実行で続きを消す
      if (!listed.truncated) {
        await deps.markFailedCleaned(job.id);
        report.failedCleaned++;
      }
      if (keys.length) log('sweep.failed_objects_deleted', { jobId: job.id, objects: keys.length });
    } catch (err) {
      log('sweep.failed_cleanup_failed', { jobId: job.id, error: errorSummary(err) });
    }
  }

  log('sweep.done', { ...report });
  return report;
}
