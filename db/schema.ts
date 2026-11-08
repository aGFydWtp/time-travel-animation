// Drizzle schema for D1（仕様 §7 / claudedocs/design.md「バックエンド」）。
// 日時は全て `new Date().toISOString()`（UTC, ミリ秒付き）で書く。文字列比較で大小が決まる形式に揃えること。
import { index, integer, sqliteTable, text, uniqueIndex } from 'void/schema-d1';

export const renderJobs = sqliteTable(
  'render_jobs',
  {
    id: text('id').primaryKey(),
    ownerId: text('owner_id').notNull(),
    configJson: text('config_json').notNull(),
    configHash: text('config_hash').notNull(),
    /** queued / running / completed / failed */
    status: text('status').notNull().default('queued'),
    stage: text('stage'),
    progress: integer('progress').notNull().default(0),
    attempt: integer('attempt').notNull().default(0),
    mp4Key: text('mp4_key'),
    movKey: text('mov_key'),
    mp4Bytes: integer('mp4_bytes'),
    movBytes: integer('mov_bytes'),
    errorCode: text('error_code'),
    errorMessage: text('error_message'),
    idempotencyKey: text('idempotency_key'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
    startedAt: text('started_at'),
    completedAt: text('completed_at'),
    /** 成果物の保持期限（completed のみ） */
    expiresAt: text('expires_at'),
    /** cron が R2 の成果物を削除済みなら 1。API は expired=true / assets=null を返す */
    expired: integer('expired').notNull().default(0),
  },
  (t) => [
    index('render_jobs_owner_created_idx').on(t.ownerId, t.createdAt),
    index('render_jobs_status_idx').on(t.status),
    index('render_jobs_owner_hash_idx').on(t.ownerId, t.configHash),
    // NULL 同士は重複扱いにならないので、キー未指定のジョブは制約を受けない
    uniqueIndex('render_jobs_owner_idem_uq').on(t.ownerId, t.idempotencyKey),
  ],
);
