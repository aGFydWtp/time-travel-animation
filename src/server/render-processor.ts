// Queue メッセージ 1 件分の処理手順。Void API は deps として注入する（Vitest で単体テストする）。
//
// 長い描画でも consumer の 1 回の呼び出し（壁時計 15 分上限）に収まるよう、処理を分ける:
//   start: queued → running（CAS）→ コンテナで render-entry をバックグラウンド起動 → poll を遅延送信
//   poll : コンテナの progress.json / result.json を読み、進捗反映 → poll を再送
//          result.json ができたら 1 つの poll だけがアップロード担当を取り（updated_at の CAS）、R2 に保存して completed
// D1 が状態の真実の源泉。重複配信・重複した poll 連鎖は CAS で収束させる。
import { safeParseRenderConfig, type RenderConfig } from '../lib/renderer/index.ts';
import {
  HEARTBEAT_STALE_MS,
  MAX_RENDER_MS,
  MIN_POLL_GAP_MS,
  POLL_DELAY_SECONDS,
  START_GRACE_MS,
  UPLOAD_DEADLINE_MS,
  UPLOAD_LEASE_MS,
  USAGE_LIMIT_RETRY_DELAY_SECONDS,
} from './constants.ts';
import { errorSummary, logEvent } from './log.ts';
import {
  assetKeys,
  claimPatch,
  completedPatch,
  failedPatch,
  progressPatch,
  requeuePatch,
  sanitizeErrorCode,
  touchPatch,
  uploadClaimPatch,
  type JobRow,
} from './job-state.ts';

export type AssetKeys = Awaited<ReturnType<typeof assetKeys>>;

/** コンテナ上のファイル読み取り結果。missing = 存在しない（ENOENT）、error = 一時的な失敗かもしれない */
export type FileRead<T> = { kind: 'ok'; value: T } | { kind: 'missing' } | { kind: 'error'; detail: string };

/** `<out>/progress.json`（container/render-entry.ts が書く。updatedAt はハートビート） */
export interface ContainerProgress {
  stage?: unknown;
  progress?: unknown;
  updatedAt?: unknown;
}

/** `<out>/result.json` */
export interface ContainerResult {
  ok?: unknown;
  errorCode?: unknown;
  message?: unknown;
  totalFrames?: unknown;
  verification?: unknown;
}

export interface SandboxStatus {
  progress: FileRead<ContainerProgress>;
  result: FileRead<ContainerResult>;
}

/** ジョブ専用 Sandbox の操作（render-runner.ts が void/sandbox と void/storage で実装する） */
export interface RenderBackend {
  /** 作業ディレクトリと設定を用意し、render-entry を切り離して起動する（完了は待たない） */
  launch(jobId: string, config: RenderConfig): Promise<void>;
  readStatus(jobId: string): Promise<SandboxStatus>;
  /** MP4 / MOV / metadata.json を R2 に保存する。同じキーへの上書きなので冪等 */
  upload(input: {
    jobId: string;
    config: RenderConfig;
    keys: AssetKeys;
    result: ContainerResult;
  }): Promise<{ mp4Bytes: number; movBytes: number }>;
  destroy(jobId: string): Promise<void>;
}

export interface ProcessorDeps {
  now(): Date;
  getJob(jobId: string): Promise<JobRow | null>;
  /** CAS: queued → running。更新できた行を返す。0 行なら null（重複配信 / 既に処理済み） */
  claim(jobId: string, patch: ReturnType<typeof claimPatch>): Promise<JobRow | null>;
  /** CAS: running のとき（expectUpdatedAt があれば updated_at も一致するとき）だけ更新し、更新できたら true */
  update(
    jobId: string,
    patch: Partial<Omit<JobRow, 'id' | 'ownerId' | 'createdAt'>>,
    opts?: { decrementAttempt?: boolean; expectUpdatedAt?: string },
  ): Promise<boolean>;
  /** poll メッセージを遅延送信する。失敗したら例外（呼び出し元のメッセージが再配信される） */
  enqueuePoll(jobId: string, delaySeconds: number): Promise<void>;
  backend: RenderBackend;
  deleteObjects(keys: string[]): Promise<void>;
  /** Sandbox の同時実行・実行時間予算の上限エラーか（void/limits の UsageLimit） */
  isUsageLimit(err: unknown): boolean;
  retentionDays: number;
  /** テスト用の上書き */
  uploadDeadlineMs?: number;
  log?: typeof logEvent;
}

export type MessageAction =
  | {
      type: 'ack';
      reason:
        | 'duplicate'
        | 'started'
        | 'polling'
        | 'completed'
        | 'failed'
        | 'lost_race'
        | 'not_running'
        | 'upload_in_progress'
        | 'duplicate_chain';
    }
  | { type: 'retry'; delaySeconds: number };

/** コンテナの progress（0..100）を API の 1..95 に写す。残りはアップロード（96）と完了（100）。進捗が後戻りしないようにする */
export const UPLOADING_PROGRESS = 96;
export function scaleContainerProgress(p: unknown): unknown {
  return typeof p === 'number' && Number.isFinite(p) ? 1 + (Math.max(0, Math.min(100, p)) * 94) / 100 : p;
}

/**
 * Sandbox のファイル操作が「存在しない」で失敗したか。
 * SDK の SandboxFileError（code=ENOENT）は RPC 越しだと `Error('SandboxFileError: … No such file or directory (os error 2)')`
 * に化ける（ローカルの workerd で確認）ので、メッセージでも判定する。それ以外の失敗は一時的なものとして扱う。
 */
export function isSandboxFileNotFound(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  if (err.name === 'SandboxFileError' && (err as { code?: unknown }).code === 'ENOENT') return true;
  const text = `${err.name}: ${err.message}`;
  return text.includes('SandboxFileError') && /No such file or directory|ENOENT|\bos error 2\b/.test(text);
}

const ms = (iso: string | null | undefined) => (iso ? Date.parse(iso) : Number.NaN);

// ---------------------------------------------------------------------------
// 純粋な判定
// ---------------------------------------------------------------------------

export type PollPrecheck =
  | { kind: 'continue' }
  | { kind: 'stop'; reason: 'not_running' | 'upload_in_progress' | 'duplicate_chain' };

/** Sandbox を触る前に行だけで判定する */
export function precheckPoll(row: Pick<JobRow, 'status' | 'stage' | 'updatedAt'> | null, now: Date): PollPrecheck {
  if (!row || row.status !== 'running') return { kind: 'stop', reason: 'not_running' };
  const sinceUpdate = now.getTime() - ms(row.updatedAt);
  if (row.stage === 'uploading') {
    // アップロード担当が生きている間は何もしない。リース切れなら引き継ぐ（担当が consumer ごと落ちた）
    return sinceUpdate < UPLOAD_LEASE_MS ? { kind: 'stop', reason: 'upload_in_progress' } : { kind: 'continue' };
  }
  // 直前に別の poll が更新した = 別の連鎖が生きている。こちらは止めて 1 本に収束させる
  if (sinceUpdate < MIN_POLL_GAP_MS) return { kind: 'stop', reason: 'duplicate_chain' };
  return { kind: 'continue' };
}

export type PollDecision =
  | { kind: 'fail'; code: string; detail?: string }
  | { kind: 'upload'; result: ContainerResult }
  /** 読み取りの一時的な失敗。何も書かずに poll を続ける（続けば cron の stale 判定で failed になる） */
  | { kind: 'transient'; detail: string }
  | { kind: 'progress'; patch: ReturnType<typeof progressPatch> | ReturnType<typeof touchPatch> };

export function decidePoll(input: { startedAt: string; now: Date; status: SandboxStatus }): PollDecision {
  const { now, status } = input;
  const elapsed = now.getTime() - ms(input.startedAt);
  if (!(elapsed <= MAX_RENDER_MS)) return { kind: 'fail', code: 'timeout', detail: `elapsed ${elapsed}ms` };

  const { result, progress } = status;
  if (result.kind === 'error') return { kind: 'transient', detail: `result.json: ${result.detail}` };
  if (result.kind === 'ok') {
    if (result.value.ok === true) return { kind: 'upload', result: result.value };
    if (result.value.ok === false) {
      const msg = typeof result.value.message === 'string' ? result.value.message : '';
      return { kind: 'fail', code: sanitizeErrorCode(result.value.errorCode), detail: `${String(result.value.errorCode)}: ${msg}` };
    }
    return { kind: 'fail', code: 'invalid_output', detail: 'result.json without boolean ok' };
  }

  if (progress.kind === 'error') return { kind: 'transient', detail: `progress.json: ${progress.detail}` };
  if (progress.kind === 'missing') {
    // 起動直後はまだ無い。猶予を過ぎても無い = コンテナが入れ替わってファイルが消えた
    return elapsed > START_GRACE_MS
      ? { kind: 'fail', code: 'container_lost', detail: 'progress.json missing' }
      : { kind: 'progress', patch: touchPatch(now) };
  }
  const heartbeat = typeof progress.value.updatedAt === 'string' ? Date.parse(progress.value.updatedAt) : Number.NaN;
  const sinceHeartbeat = Number.isFinite(heartbeat) ? now.getTime() - heartbeat : elapsed;
  if (sinceHeartbeat > HEARTBEAT_STALE_MS) {
    return { kind: 'fail', code: 'stalled', detail: `no heartbeat for ${sinceHeartbeat}ms` };
  }
  return {
    kind: 'progress',
    patch: progressPatch(progress.value.stage, scaleContainerProgress(progress.value.progress), now),
  };
}

/** completed の CAS に負けたあと、書いた R2 オブジェクトを消してよいか（他の poll が completed にしたなら消さない） */
export function shouldDeleteAfterLostCompletion(current: Pick<JobRow, 'status'> | null): boolean {
  return current?.status !== 'completed';
}

class DeadlineError extends Error {
  override name = 'TimeoutError';
}

async function withDeadline<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new DeadlineError(`deadline ${timeoutMs}ms exceeded`)), timeoutMs);
  });
  try {
    return await Promise.race([promise, deadline]);
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// 手順
// ---------------------------------------------------------------------------

function helpers(deps: ProcessorDeps, jobId: string) {
  const log = deps.log ?? logEvent;
  const destroy = async () => {
    await deps.backend.destroy(jobId).catch((err: unknown) => {
      log('render.sandbox_destroy_failed', { jobId, error: errorSummary(err) });
    });
  };
  const fail = async (code: string, startedAt: string | null, detail?: string): Promise<MessageAction> => {
    const patch = failedPatch(code, deps.now());
    const updated = await deps.update(jobId, patch);
    log('render.failed', {
      jobId,
      errorCode: patch.errorCode,
      detail: detail?.slice(0, 300),
      durationMs: startedAt ? deps.now().getTime() - ms(startedAt) : null,
      stateUpdated: updated,
    });
    return { type: 'ack', reason: updated ? 'failed' : 'lost_race' };
  };
  return { log, destroy, fail };
}

function parseStoredConfig(row: JobRow): RenderConfig | null {
  try {
    const parsed = safeParseRenderConfig(JSON.parse(row.configJson));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export async function processStartMessage(deps: ProcessorDeps, jobId: string): Promise<MessageAction> {
  const { log, destroy, fail } = helpers(deps, jobId);
  const row = await deps.claim(jobId, claimPatch(deps.now()));
  if (!row) {
    // 重複配信。起動済み（running）なら poll 連鎖が切れている可能性があるので poll を足す（重複連鎖は poll 側で収束）
    const current = await deps.getJob(jobId);
    if (current?.status === 'running') await deps.enqueuePoll(jobId, POLL_DELAY_SECONDS);
    log('render.skip_duplicate', { jobId, status: current?.status ?? null });
    return { type: 'ack', reason: 'duplicate' };
  }
  log('render.claimed', { jobId, attempt: row.attempt });

  const config = parseStoredConfig(row);
  if (!config) return await fail('invalid_config', row.startedAt);

  try {
    await deps.backend.launch(jobId, config);
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
    const action = await fail('sandbox_unavailable', row.startedAt, errorSummary(err));
    await destroy();
    return action;
  }

  await deps.update(jobId, progressPatch('starting', 1, deps.now()));
  // 送れなければ例外 → この start が再配信され、claim 済みなので poll だけ送り直す
  await deps.enqueuePoll(jobId, POLL_DELAY_SECONDS);
  log('render.launched', { jobId });
  return { type: 'ack', reason: 'started' };
}

export async function processPollMessage(deps: ProcessorDeps, jobId: string): Promise<MessageAction> {
  const { log, destroy, fail } = helpers(deps, jobId);
  const row = await deps.getJob(jobId);
  const pre = precheckPoll(row, deps.now());
  if (pre.kind === 'stop' || !row) {
    if (pre.kind === 'stop' && pre.reason !== 'not_running') log('render.poll_skip', { jobId, reason: pre.reason });
    return { type: 'ack', reason: pre.kind === 'stop' ? pre.reason : 'not_running' };
  }
  const startedAt = row.startedAt ?? row.updatedAt;

  let status: SandboxStatus;
  try {
    status = await deps.backend.readStatus(jobId);
  } catch (err) {
    status = { progress: { kind: 'error', detail: errorSummary(err) }, result: { kind: 'error', detail: errorSummary(err) } };
  }
  const decision = decidePoll({ startedAt, now: deps.now(), status });

  switch (decision.kind) {
    case 'transient': {
      log('render.poll_transient', { jobId, detail: decision.detail.slice(0, 300) });
      await deps.enqueuePoll(jobId, POLL_DELAY_SECONDS);
      return { type: 'ack', reason: 'polling' };
    }
    case 'progress': {
      // updated_at の CAS: 同時に走った別の poll が先に書いたら、こちらの連鎖は止める
      const ok = await deps.update(jobId, decision.patch, { expectUpdatedAt: row.updatedAt });
      if (!ok) return { type: 'ack', reason: 'duplicate_chain' };
      await deps.enqueuePoll(jobId, POLL_DELAY_SECONDS);
      return { type: 'ack', reason: 'polling' };
    }
    case 'fail': {
      const action = await fail(decision.code, startedAt, decision.detail);
      await destroy();
      return action;
    }
    case 'upload':
      return await uploadAndComplete(deps, row, decision.result, startedAt);
  }
}

async function uploadAndComplete(
  deps: ProcessorDeps,
  row: JobRow,
  result: ContainerResult,
  startedAt: string,
): Promise<MessageAction> {
  const jobId = row.id;
  const { log, destroy, fail } = helpers(deps, jobId);

  // アップロード担当は 1 つの poll だけ（読んだ updated_at の CAS）
  const claimed = await deps.update(jobId, uploadClaimPatch(UPLOADING_PROGRESS, deps.now()), {
    expectUpdatedAt: row.updatedAt,
  });
  if (!claimed) return { type: 'ack', reason: 'duplicate_chain' };

  const config = parseStoredConfig(row);
  if (!config) {
    const action = await fail('invalid_config', startedAt);
    await destroy();
    return action;
  }
  const keys = await assetKeys(row.ownerId, row.id);
  const allKeys = [keys.mp4, keys.mov, keys.metadata];
  const deleteKeys = async (why: string) => {
    try {
      await deps.deleteObjects(allKeys);
      log('render.objects_deleted', { jobId, why, objects: allKeys.length });
    } catch (err) {
      // 消し損ねは cron の failed 掃除が拾う
      log('render.objects_delete_failed', { jobId, why, error: errorSummary(err) });
    }
  };

  let sizes: { mp4Bytes: number; movBytes: number };
  try {
    sizes = await withDeadline(
      deps.backend.upload({ jobId, config, keys, result }),
      deps.uploadDeadlineMs ?? UPLOAD_DEADLINE_MS,
    );
  } catch (err) {
    const timedOut = err instanceof DeadlineError;
    log('render.upload_failed', { jobId, timedOut, error: errorSummary(err) });
    const action = await fail(timedOut ? 'timeout' : 'upload_failed', startedAt, errorSummary(err));
    // failed にできたときだけ消す（他の poll が completed にした成果物は消さない）
    if (action.type === 'ack' && action.reason === 'failed') await deleteKeys('upload_failed');
    await destroy();
    return action;
  }

  const patch = completedPatch({
    now: deps.now(),
    retentionDays: deps.retentionDays,
    mp4Key: keys.mp4,
    movKey: keys.mov,
    mp4Bytes: sizes.mp4Bytes,
    movBytes: sizes.movBytes,
  });
  const updated = await deps.update(jobId, patch);
  log('render.completed', {
    jobId,
    durationMs: deps.now().getTime() - ms(startedAt),
    mp4Bytes: sizes.mp4Bytes,
    movBytes: sizes.movBytes,
    stateUpdated: updated,
  });
  if (!updated) {
    // アップロード中に cron が stale で failed にした等。failed のジョブに成果物を残さない
    // 状態を読めなければ消さない（completed かもしれない。failed なら cron の掃除が拾う）
    const current = await deps.getJob(jobId).then(
      (r) => ({ known: true as const, row: r }),
      () => ({ known: false as const }),
    );
    if (current.known && shouldDeleteAfterLostCompletion(current.row)) await deleteKeys('lost_race');
  }
  await destroy();
  return { type: 'ack', reason: updated ? 'completed' : 'lost_race' };
}
