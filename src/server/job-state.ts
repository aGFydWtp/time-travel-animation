// ジョブ状態の純粋ロジック（行 → API DTO、状態遷移の次状態、エラーのサニタイズ、R2 キー）。
// void/* や @schema を import しない（Vitest から直接テストする）。
import type {
  AssetFormat,
  JobStage,
  JobStatus,
  RenderAssetInfo,
  RenderJob,
} from '../lib/api/types.ts';
import type { RenderConfig } from '../lib/renderer/index.ts';

/** render_jobs 行の構造的な型（Drizzle の推論型と互換） */
export interface JobRow {
  id: string;
  ownerId: string;
  configJson: string;
  configHash: string;
  status: string;
  stage: string | null;
  progress: number;
  attempt: number;
  mp4Key: string | null;
  movKey: string | null;
  mp4Bytes: number | null;
  movBytes: number | null;
  errorCode: string | null;
  errorMessage: string | null;
  idempotencyKey: string | null;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  expiresAt: string | null;
  expired: number;
}

export const JOB_STATUSES = ['queued', 'running', 'completed', 'failed'] as const satisfies readonly JobStatus[];
export const ACTIVE_STATUSES = ['queued', 'running'] as const satisfies readonly JobStatus[];
export const JOB_STAGES = [
  'queued',
  'starting',
  'rendering_frames',
  'encoding',
  'uploading',
  'validating',
  'done',
] as const satisfies readonly JobStage[];

export const ASSET_FORMATS = ['mp4', 'mov'] as const satisfies readonly AssetFormat[];

export const ASSET_SPECS = {
  mp4: { fileName: 'preview.mp4', contentType: 'video/mp4' },
  mov: { fileName: 'transparent.mov', contentType: 'video/quicktime' },
} as const satisfies Record<AssetFormat, { fileName: string; contentType: RenderAssetInfo['contentType'] }>;

export function isAssetFormat(v: string | undefined): v is AssetFormat {
  return v === 'mp4' || v === 'mov';
}

export function isJobStage(v: unknown): v is JobStage {
  return typeof v === 'string' && (JOB_STAGES as readonly string[]).includes(v);
}

function asStatus(v: string): JobStatus {
  return (JOB_STATUSES as readonly string[]).includes(v) ? (v as JobStatus) : 'failed';
}

// ---------------------------------------------------------------------------
// エラーのサニタイズ
// ---------------------------------------------------------------------------

/** UI に出してよいエラーコードと表示文言。これ以外のコードは render_failed に丸める。 */
export const ERROR_MESSAGES: Record<string, string> = {
  render_failed: '動画のレンダリングに失敗しました',
  encode_failed: '動画のエンコードに失敗しました',
  verification_failed: '書き出したファイルの検証に失敗しました',
  invalid_output: 'レンダラーの出力が不正でした',
  upload_failed: '書き出したファイルの保存に失敗しました',
  timeout: 'レンダリングが制限時間内に終わりませんでした',
  sandbox_unavailable: 'レンダリング環境を起動できませんでした',
  invalid_config: '保存された設定が不正です',
  stale: '処理が中断されました（タイムアウト）',
  internal: '内部エラーが発生しました',
};

/** コンテナ（container/render-entry.ts）が result.json に書くエラーコード → API のコード */
export const CONTAINER_ERROR_MAP: Record<string, string> = {
  INVALID_ARGS: 'internal',
  INVALID_CONFIG: 'invalid_config',
  BROWSER_LAUNCH_FAILED: 'render_failed',
  PAGE_INIT_FAILED: 'render_failed',
  FRAME_RENDER_FAILED: 'render_failed',
  ENCODE_MP4_FAILED: 'encode_failed',
  ENCODE_MOV_FAILED: 'encode_failed',
  VERIFY_FAILED: 'verification_failed',
  IO_ERROR: 'render_failed',
};

/** コンテナが progress.json に書く stage 名 → API の JobStage */
export const CONTAINER_STAGE_MAP: Record<string, JobStage> = {
  starting: 'starting',
  rendering: 'rendering_frames',
  rendering_frames: 'rendering_frames',
  encoding: 'encoding',
  encoding_mp4: 'encoding',
  encoding_mov: 'encoding',
  verifying: 'validating',
  validating: 'validating',
  uploading: 'uploading',
};

export function sanitizeErrorCode(code: unknown): string {
  if (typeof code !== 'string') return 'render_failed';
  if (Object.hasOwn(ERROR_MESSAGES, code)) return code;
  if (Object.hasOwn(CONTAINER_ERROR_MAP, code)) return CONTAINER_ERROR_MAP[code]!;
  return 'render_failed';
}

export function sanitizedError(code: unknown): { errorCode: string; errorMessage: string } {
  const errorCode = sanitizeErrorCode(code);
  return { errorCode, errorMessage: ERROR_MESSAGES[errorCode]! };
}

// ---------------------------------------------------------------------------
// R2 キー
// ---------------------------------------------------------------------------

/** owner_id の SHA-256 先頭 16 桁（ユーザー文字列をそのままパスに入れない） */
export async function ownerHash(ownerId: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(ownerId));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 16);
}

export async function assetKeys(ownerId: string, jobId: string) {
  const prefix = `renders/${await ownerHash(ownerId)}/${jobId}`;
  return {
    mp4: `${prefix}/${ASSET_SPECS.mp4.fileName}`,
    mov: `${prefix}/${ASSET_SPECS.mov.fileName}`,
    metadata: `${prefix}/metadata.json`,
  };
}

// ---------------------------------------------------------------------------
// 行 → API DTO
// ---------------------------------------------------------------------------

export function isExpired(row: Pick<JobRow, 'status' | 'expired' | 'expiresAt'>, now: Date): boolean {
  if (row.status !== 'completed') return false;
  if (row.expired === 1) return true;
  return row.expiresAt !== null && row.expiresAt <= now.toISOString();
}

export function assetUrls(jobId: string, format: AssetFormat) {
  const url = `/api/renders/${encodeURIComponent(jobId)}/assets/${format}`;
  return { url, downloadUrl: `${url}?download=1` };
}

export function toRenderJob(row: JobRow, now: Date): RenderJob {
  const status = asStatus(row.status);
  const expired = isExpired(row, now);
  let assets: RenderJob['assets'] = null;
  if (status === 'completed' && !expired && row.mp4Key && row.movKey) {
    const info = (format: AssetFormat, bytes: number | null): RenderAssetInfo => ({
      format,
      contentType: ASSET_SPECS[format].contentType,
      bytes: bytes ?? 0,
      ...assetUrls(row.id, format),
    });
    assets = { mp4: info('mp4', row.mp4Bytes), mov: info('mov', row.movBytes) };
  }
  return {
    id: row.id,
    status,
    stage: isJobStage(row.stage) ? row.stage : null,
    progress: Math.max(0, Math.min(100, Math.round(row.progress))),
    attempt: row.attempt,
    config: JSON.parse(row.configJson) as RenderConfig,
    configHash: row.configHash,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
    expiresAt: status === 'completed' ? row.expiresAt : null,
    expired,
    error:
      status === 'failed'
        ? { code: sanitizeErrorCode(row.errorCode), message: sanitizedError(row.errorCode).errorMessage }
        : null,
    assets,
  };
}

// ---------------------------------------------------------------------------
// アクセス判定
// ---------------------------------------------------------------------------

/** 他人のジョブは存在しないものとして扱う（404）。 */
export function ownedOrNull<T extends Pick<JobRow, 'ownerId'>>(row: T | null | undefined, ownerId: string): T | null {
  return row && row.ownerId === ownerId ? row : null;
}

export type AssetAccess =
  | { ok: true; key: string; contentType: RenderAssetInfo['contentType']; bytes: number | null }
  | { ok: false; status: 404 | 409; code: 'not_found' | 'not_ready'; message: string };

export function decideAssetAccess(
  row: JobRow | null | undefined,
  ownerId: string,
  format: string | undefined,
  now: Date,
): AssetAccess {
  const job = ownedOrNull(row, ownerId);
  if (!job) return { ok: false, status: 404, code: 'not_found', message: 'ジョブが見つかりません' };
  if (!isAssetFormat(format)) {
    return { ok: false, status: 404, code: 'not_found', message: '形式は mp4 か mov です' };
  }
  if (job.status !== 'completed') {
    return { ok: false, status: 409, code: 'not_ready', message: 'まだ書き出しが完了していません' };
  }
  if (isExpired(job, now)) {
    return { ok: false, status: 404, code: 'not_found', message: '保持期限を過ぎたため削除されました' };
  }
  const key = format === 'mp4' ? job.mp4Key : job.movKey;
  if (!key) return { ok: false, status: 404, code: 'not_found', message: 'ファイルが見つかりません' };
  return {
    ok: true,
    key,
    contentType: ASSET_SPECS[format].contentType,
    bytes: format === 'mp4' ? job.mp4Bytes : job.movBytes,
  };
}

/** `countdown-<id 先頭 8 文字>.<ext>`（ユーザー文字列はファイル名に入れない） */
export function downloadFileName(jobId: string, format: AssetFormat): string {
  const prefix = jobId.replace(/[^0-9a-zA-Z]/g, '').slice(0, 8) || 'render';
  return `countdown-${prefix}.${format}`;
}

// ---------------------------------------------------------------------------
// ジョブ作成の判定
// ---------------------------------------------------------------------------

export type CreateDecision =
  | { kind: 'reuse'; job: Pick<JobRow, 'id' | 'status'> }
  | { kind: 'rate_limited'; message: string }
  | { kind: 'create' };

export interface CreateContext {
  /** 同じ idempotencyKey で作られた既存ジョブ */
  idempotent: Pick<JobRow, 'id' | 'status'> | null;
  /** 利用者の進行中（queued/running）ジョブ */
  active: Pick<JobRow, 'id' | 'status' | 'configHash'>[];
  configHash: string;
  /** 直近 1 時間に作成したジョブ数 */
  recentCount: number;
  activeLimit: number;
  hourlyLimit: number;
}

export function decideCreate(ctx: CreateContext): CreateDecision {
  if (ctx.idempotent) return { kind: 'reuse', job: ctx.idempotent };
  const same = ctx.active.find((j) => j.configHash === ctx.configHash);
  if (same) return { kind: 'reuse', job: same };
  if (ctx.active.length >= ctx.activeLimit) {
    return { kind: 'rate_limited', message: '進行中の書き出しが終わるまでお待ちください' };
  }
  if (ctx.recentCount >= ctx.hourlyLimit) {
    return { kind: 'rate_limited', message: '1 時間あたりの書き出し回数の上限に達しました' };
  }
  return { kind: 'create' };
}

// ---------------------------------------------------------------------------
// 状態遷移で書き込む値（CAS の WHERE 句は repo 側で status を必ず条件に入れる）
// ---------------------------------------------------------------------------

export function newJobValues(input: {
  id: string;
  ownerId: string;
  configJson: string;
  configHash: string;
  idempotencyKey: string | null;
  now: Date;
}): JobRow {
  const ts = input.now.toISOString();
  return {
    id: input.id,
    ownerId: input.ownerId,
    configJson: input.configJson,
    configHash: input.configHash,
    status: 'queued',
    stage: 'queued',
    progress: 0,
    attempt: 0,
    mp4Key: null,
    movKey: null,
    mp4Bytes: null,
    movBytes: null,
    errorCode: null,
    errorMessage: null,
    idempotencyKey: input.idempotencyKey,
    createdAt: ts,
    updatedAt: ts,
    startedAt: null,
    completedAt: null,
    expiresAt: null,
    expired: 0,
  };
}

/** queued → running */
export function claimPatch(now: Date) {
  const ts = now.toISOString();
  return { status: 'running', stage: 'starting', progress: 0, startedAt: ts, updatedAt: ts } as const;
}

/** running → completed */
export function completedPatch(input: {
  now: Date;
  retentionDays: number;
  mp4Key: string;
  movKey: string;
  mp4Bytes: number;
  movBytes: number;
}) {
  const ts = input.now.toISOString();
  const expiresAt = new Date(input.now.getTime() + input.retentionDays * 24 * 60 * 60 * 1000).toISOString();
  return {
    status: 'completed',
    stage: 'done',
    progress: 100,
    mp4Key: input.mp4Key,
    movKey: input.movKey,
    mp4Bytes: input.mp4Bytes,
    movBytes: input.movBytes,
    errorCode: null,
    errorMessage: null,
    completedAt: ts,
    expiresAt,
    updatedAt: ts,
  } as const;
}

/** running → failed */
export function failedPatch(code: unknown, now: Date) {
  return { status: 'failed', ...sanitizedError(code), updatedAt: now.toISOString() } as const;
}

/** running → queued（Sandbox の利用上限に当たったときの差し戻し。試行回数は戻す） */
export function requeuePatch(now: Date) {
  return { status: 'queued', stage: 'queued', progress: 0, startedAt: null, updatedAt: now.toISOString() } as const;
}

/** 進捗 → stage/progress（コンテナが返す値は信用せず丸める。done/failed は consumer 側の遷移で付ける） */
export function progressPatch(stage: unknown, progress: unknown, now: Date) {
  const p = typeof progress === 'number' && Number.isFinite(progress) ? progress : 0;
  const mapped = typeof stage === 'string' && Object.hasOwn(CONTAINER_STAGE_MAP, stage) ? CONTAINER_STAGE_MAP[stage] : undefined;
  return {
    ...(mapped ? { stage: mapped } : {}),
    // 100 は completed 遷移で付ける
    progress: Math.max(0, Math.min(99, Math.round(p))),
    updatedAt: now.toISOString(),
  };
}

export function parseRetentionDays(raw: string | undefined, def: number): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 && n <= 3650 ? n : def;
}
