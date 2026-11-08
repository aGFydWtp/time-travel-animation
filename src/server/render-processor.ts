// Queue メッセージ 1 件分の処理手順。Void API は deps として注入する（Vitest で単体テストする）。
import { safeParseRenderConfig, type RenderConfig } from '../lib/renderer/index.ts';
import { USAGE_LIMIT_RETRY_DELAY_SECONDS } from './constants.ts';
import { errorSummary, logEvent } from './log.ts';
import {
  assetKeys,
  claimPatch,
  completedPatch,
  failedPatch,
  progressPatch,
  requeuePatch,
  sanitizeErrorCode,
  type JobRow,
} from './job-state.ts';

export type AssetKeys = Awaited<ReturnType<typeof assetKeys>>;

export type RunResult =
  | { ok: true; mp4: { bytes: number }; mov: { bytes: number } }
  | { ok: false; errorCode: string; message: string };

export type ProgressCallback = (p: { stage: unknown; progress: unknown }) => Promise<void> | void;

export interface ProcessorDeps {
  now(): Date;
  /** CAS: queued → running。更新できた行を返す。0 行なら null（重複配信 / 既に処理済み） */
  claim(jobId: string, patch: ReturnType<typeof claimPatch>): Promise<JobRow | null>;
  /** CAS: running のときだけ更新し、更新できたら true */
  update(
    jobId: string,
    patch:
      | ReturnType<typeof completedPatch>
      | ReturnType<typeof failedPatch>
      | ReturnType<typeof requeuePatch>
      | ReturnType<typeof progressPatch>,
    opts?: { decrementAttempt?: boolean },
  ): Promise<boolean>;
  run(jobId: string, config: RenderConfig, keys: AssetKeys, onProgress: ProgressCallback): Promise<RunResult>;
  /** Sandbox の同時実行・実行時間予算の上限エラーか（void/limits の UsageLimit） */
  isUsageLimit(err: unknown): boolean;
  retentionDays: number;
  log?: typeof logEvent;
}

export type MessageAction =
  | { type: 'ack'; reason: 'duplicate' | 'completed' | 'failed' | 'lost_race' }
  | { type: 'retry'; delaySeconds: number };

export async function processRenderMessage(deps: ProcessorDeps, jobId: string): Promise<MessageAction> {
  const log = deps.log ?? logEvent;
  const started = deps.now();

  const row = await deps.claim(jobId, claimPatch(started));
  if (!row) {
    log('render.skip_duplicate', { jobId });
    return { type: 'ack', reason: 'duplicate' };
  }
  log('render.claimed', { jobId, attempt: row.attempt });

  const fail = async (code: string, detail?: string): Promise<MessageAction> => {
    const patch = failedPatch(code, deps.now());
    const updated = await deps.update(jobId, patch);
    log('render.failed', {
      jobId,
      errorCode: patch.errorCode,
      detail: detail?.slice(0, 300),
      durationMs: deps.now().getTime() - started.getTime(),
      stateUpdated: updated,
    });
    return { type: 'ack', reason: updated ? 'failed' : 'lost_race' };
  };

  let config: RenderConfig;
  try {
    const parsed = safeParseRenderConfig(JSON.parse(row.configJson));
    if (!parsed.success) return await fail('invalid_config');
    config = parsed.data;
  } catch {
    return await fail('invalid_config');
  }

  const keys = await assetKeys(row.ownerId, row.id);
  const onProgress: ProgressCallback = async ({ stage, progress }) => {
    try {
      await deps.update(jobId, progressPatch(stage, progress, deps.now()));
    } catch (err) {
      log('render.progress_update_failed', { jobId, error: errorSummary(err) });
    }
  };

  let result: RunResult;
  try {
    result = await deps.run(jobId, config, keys, onProgress);
  } catch (err) {
    if (deps.isUsageLimit(err)) {
      const requeued = await deps.update(jobId, requeuePatch(deps.now()), { decrementAttempt: true });
      log('render.requeued_usage_limit', {
        jobId,
        error: errorSummary(err),
        delaySeconds: USAGE_LIMIT_RETRY_DELAY_SECONDS,
        stateUpdated: requeued,
      });
      // 差し戻せなかった（他経路で状態が変わった）なら再配信しても CAS で skip されるだけ
      return { type: 'retry', delaySeconds: USAGE_LIMIT_RETRY_DELAY_SECONDS };
    }
    return await fail('render_failed', errorSummary(err));
  }

  if (!result.ok) {
    return await fail(sanitizeErrorCode(result.errorCode), `${result.errorCode}: ${result.message}`);
  }

  const patch = completedPatch({
    now: deps.now(),
    retentionDays: deps.retentionDays,
    mp4Key: keys.mp4,
    movKey: keys.mov,
    mp4Bytes: result.mp4.bytes,
    movBytes: result.mov.bytes,
  });
  const updated = await deps.update(jobId, patch);
  log('render.completed', {
    jobId,
    durationMs: deps.now().getTime() - started.getTime(),
    mp4Bytes: result.mp4.bytes,
    movBytes: result.mov.bytes,
    stateUpdated: updated,
  });
  return { type: 'ack', reason: updated ? 'completed' : 'lost_race' };
}
