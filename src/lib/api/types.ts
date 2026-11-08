// API 契約（サーバー routes/api/** とクライアント src/lib/api/client.ts の共有型）。
// 仕様 §6 / claudedocs/design.md に準拠。変更する場合は両側を同時に更新すること。
import type { RenderConfig } from '../renderer/types.ts';

export type JobStatus = 'queued' | 'running' | 'completed' | 'failed';

export type JobStage =
  | 'queued'
  | 'starting'
  | 'rendering_frames'
  | 'encoding'
  | 'uploading'
  | 'validating'
  | 'done';

export type AssetFormat = 'mp4' | 'mov';

export interface RenderAssetInfo {
  format: AssetFormat;
  contentType: 'video/mp4' | 'video/quicktime';
  bytes: number;
  /** インライン再生用（Range 対応の Worker プロキシ）。同一オリジンの相対 URL。 */
  url: string;
  /** `Content-Disposition: attachment` 付きのダウンロード URL。 */
  downloadUrl: string;
}

export interface RenderJobError {
  /** サニタイズ済みの機械可読コード（例: 'render_failed', 'timeout', 'stale'）。 */
  code: string;
  /** 画面表示用の短い説明。内部コマンドやスタックトレースは含めない。 */
  message: string;
}

export interface RenderJob {
  id: string;
  status: JobStatus;
  stage: JobStage | null;
  /** 0..100 の概算 */
  progress: number;
  attempt: number;
  config: RenderConfig;
  configHash: string;
  createdAt: string; // UTC ISO 8601
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  /** 成果物の保持期限（completed のみ）。過ぎたら assets は null、expired=true。 */
  expiresAt: string | null;
  expired: boolean;
  error: RenderJobError | null;
  /** completed かつ未失効のときだけ非 null。完了前の URL は返さない。 */
  assets: { mp4: RenderAssetInfo; mov: RenderAssetInfo } | null;
}

/** POST /api/renders のリクエスト */
export interface CreateRenderRequest {
  config: RenderConfig;
  idempotencyKey?: string;
}

/**
 * POST /api/renders のレスポンス。
 * 202: 新規作成（reused=false） / 200: 進行中の同一設定ジョブを再利用（reused=true）
 */
export interface CreateRenderResponse {
  id: string;
  status: JobStatus;
  reused: boolean;
}

/** GET /api/renders?cursor=&limit= */
export interface ListRendersResponse {
  items: RenderJob[];
  /** 次ページ取得用の不透明なカーソル。最終ページなら null。 */
  nextCursor: string | null;
}

/** POST /api/renders/:id/retry → 202 */
export type RetryRenderResponse = CreateRenderResponse;

/** 4xx/5xx 共通のエラーボディ */
export interface ApiErrorBody {
  error: {
    code:
      | 'invalid_request'
      | 'unauthorized'
      | 'forbidden'
      | 'not_found'
      | 'conflict'
      | 'rate_limited'
      | 'not_ready'
      | 'auth_not_configured'
      | 'internal';
    message: string;
    /** invalid_request のときの Zod issue（path と message のみ） */
    issues?: { path: (string | number)[]; message: string }[];
  };
}
