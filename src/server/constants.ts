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
/** updated_at がこれより古い running は取り残されたとみなし failed(stale) にする（poll は 10 秒毎、アップロード担当は UPLOAD_LEASE_MS まで更新しない） */
export const STALE_RUNNING_MS = 20 * 60 * 1000;
/** cron 1 回あたりに処理する件数の上限 */
export const SWEEP_BATCH_SIZE = 20;

/** Sandbox の同時実行上限等に当たったときの再配信遅延 */
export const USAGE_LIMIT_RETRY_DELAY_SECONDS = 60;

export const DEFAULT_RETENTION_DAYS = 30;

/** POST ボディの上限（設定 JSON は数百バイト） */
export const MAX_REQUEST_BODY_BYTES = 16 * 1024;

// --- 長時間レンダリング（Sandbox でバックグラウンド実行し、Queue の遅延メッセージでポーリングする） ---
// Queue consumer は 1 回の呼び出しが壁時計 15 分で打ち切られる。描画はコンテナ内で切り離して走らせ、
// consumer は「起動」「状態確認」「アップロード」の短い呼び出しに分ける。

/** poll メッセージの遅延 */
export const POLL_DELAY_SECONDS = 10;
/** 直前の poll からこれ未満なら別の poll 連鎖が生きているとみなし、この連鎖を止める（重複連鎖の収束） */
export const MIN_POLL_GAP_MS = 5_000;
/**
 * progress.json が一度も現れないまま、起動（launch() 完了。不明なら claim 時刻）からこれを過ぎたら
 * コンテナが失われたとみなす。render-entry は起動直後に progress.json を書く
 */
export const START_GRACE_MS = 5 * 60 * 1000;
/** progress.json の updatedAt（コンテナのハートビート）がこれより古ければ止まったとみなす */
export const HEARTBEAT_STALE_MS = 3 * 60 * 1000;
/** started_at からの全体上限 */
export const MAX_RENDER_MS = 2 * 60 * 60 * 1000;
/** R2 へのアップロード（MP4 + MOV + metadata）の上限。consumer の 15 分に十分収める */
export const UPLOAD_DEADLINE_MS = 10 * 60 * 1000;
/** stage=uploading の担当 poll がこれより長く更新しなければ、別の poll がアップロードを引き継ぐ */
export const UPLOAD_LEASE_MS = 12 * 60 * 1000;
/** Sandbox を無操作で止めるまでの時間（poll が 10 秒毎にファイルを読むので通常は切れない） */
export const SANDBOX_INACTIVITY_TIMEOUT_MS = 30 * 60 * 1000;
/** running の updated_at がこれより古ければ poll 連鎖が切れたとみなし、cron が poll を再送する */
export const POLL_RESEND_AFTER_MS = 2 * 60 * 1000;
/** failed になってからこれを過ぎたジョブの R2 プレフィックスを掃除する（遅れて届いた put の取りこぼし対策） */
export const FAILED_CLEANUP_AFTER_MS = 60 * 60 * 1000;
