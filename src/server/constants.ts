// サーバー側の運用パラメータ（1 か所に集約）。

/** ユーザーごとの同時進行ジョブ（queued + running）の上限（仕様 §10） */
export const ACTIVE_JOB_LIMIT = 1;
/** ユーザーごとの 1 時間あたりのジョブ作成上限 */
export const HOURLY_JOB_LIMIT = 20;
export const HOUR_MS = 60 * 60 * 1000;

export const LIST_DEFAULT_LIMIT = 20;
export const LIST_MAX_LIMIT = 50;

/** Queue 送信失敗の救済: これより古い queued を cron が再送する */
export const REQUEUE_AFTER_MS = 2 * 60 * 1000;
/** updated_at がこれより古い running は取り残されたとみなし failed(stale) にする */
export const STALE_RUNNING_MS = 20 * 60 * 1000;
/** cron 1 回あたりに処理する件数の上限 */
export const SWEEP_BATCH_SIZE = 20;

/** Sandbox の同時実行上限等に当たったときの再配信遅延 */
export const USAGE_LIMIT_RETRY_DELAY_SECONDS = 60;

export const DEFAULT_RETENTION_DAYS = 30;

/** POST ボディの上限（設定 JSON は数百バイト） */
export const MAX_REQUEST_BODY_BYTES = 16 * 1024;
