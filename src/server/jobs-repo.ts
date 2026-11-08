// render_jobs の D1 アクセス。状態遷移は全て「現在の status を WHERE に入れる」比較更新（CAS）。
import { renderJobs } from '@schema';
import { and, asc, count, db, desc, eq, gte, inArray, lt, lte, or, sql } from 'void/db';
import type { ListCursor } from './cursor.ts';
import { ACTIVE_STATUSES, type JobRow } from './job-state.ts';

type Patch = Partial<Omit<JobRow, 'id' | 'ownerId' | 'createdAt'>>;

export async function getJob(id: string): Promise<JobRow | null> {
  const [row] = await db.select().from(renderJobs).where(eq(renderJobs.id, id)).limit(1);
  return row ?? null;
}

/** 利用者のジョブだけを返す（他人のジョブは null = 404） */
export async function findOwnedJob(id: string, ownerId: string): Promise<JobRow | null> {
  const [row] = await db
    .select()
    .from(renderJobs)
    .where(and(eq(renderJobs.id, id), eq(renderJobs.ownerId, ownerId)))
    .limit(1);
  return row ?? null;
}

export async function listOwnedJobs(ownerId: string, cursor: ListCursor | null, limit: number): Promise<JobRow[]> {
  const where = cursor
    ? and(
        eq(renderJobs.ownerId, ownerId),
        or(
          lt(renderJobs.createdAt, cursor.createdAt),
          and(eq(renderJobs.createdAt, cursor.createdAt), lt(renderJobs.id, cursor.id)),
        ),
      )
    : eq(renderJobs.ownerId, ownerId);
  return db
    .select()
    .from(renderJobs)
    .where(where)
    .orderBy(desc(renderJobs.createdAt), desc(renderJobs.id))
    .limit(limit);
}

export async function findByIdempotencyKey(ownerId: string, key: string): Promise<JobRow | null> {
  const [row] = await db
    .select()
    .from(renderJobs)
    .where(and(eq(renderJobs.ownerId, ownerId), eq(renderJobs.idempotencyKey, key)))
    .limit(1);
  return row ?? null;
}

export async function findActiveJobs(ownerId: string): Promise<JobRow[]> {
  return db
    .select()
    .from(renderJobs)
    .where(and(eq(renderJobs.ownerId, ownerId), inArray(renderJobs.status, [...ACTIVE_STATUSES])))
    .orderBy(desc(renderJobs.createdAt));
}

export async function countCreatedSince(ownerId: string, sinceIso: string): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(renderJobs)
    .where(and(eq(renderJobs.ownerId, ownerId), gte(renderJobs.createdAt, sinceIso)));
  return row?.n ?? 0;
}

/**
 * 進行中ジョブ数が上限未満のときだけ挿入する（1 文で判定と挿入を行い、同時リクエストでも上限を超えない）。
 * 挿入できたら true。idempotency_key の一意制約違反は例外になる。
 */
export async function insertJobIfBelowActiveLimit(row: JobRow, activeLimit: number): Promise<boolean> {
  const result = await db.run(sql`
    INSERT INTO render_jobs (
      id, owner_id, config_json, config_hash, status, stage, progress, attempt,
      idempotency_key, created_at, updated_at, expired
    )
    SELECT ${row.id}, ${row.ownerId}, ${row.configJson}, ${row.configHash}, ${row.status}, ${row.stage},
      ${row.progress}, ${row.attempt}, ${row.idempotencyKey}, ${row.createdAt}, ${row.updatedAt}, ${row.expired}
    WHERE (
      SELECT count(*) FROM render_jobs
      WHERE owner_id = ${row.ownerId} AND status IN ('queued', 'running')
    ) < ${activeLimit}
  `);
  return (result.meta?.changes ?? 0) > 0;
}

/** CAS: queued → running（attempt+1）。更新できた行を返す。 */
export async function claimQueuedJob(id: string, patch: Patch): Promise<JobRow | null> {
  const [row] = await db
    .update(renderJobs)
    .set({ ...patch, attempt: sql`${renderJobs.attempt} + 1` })
    .where(and(eq(renderJobs.id, id), eq(renderJobs.status, 'queued')))
    .returning();
  return row ?? null;
}

/** CAS: 現在 `from` 状態のときだけ更新する。更新できたら true。 */
export async function updateJobIfStatus(
  id: string,
  from: JobRow['status'],
  patch: Patch,
  opts: { decrementAttempt?: boolean } = {},
): Promise<boolean> {
  const set = opts.decrementAttempt
    ? { ...patch, attempt: sql`max(${renderJobs.attempt} - 1, 0)` }
    : patch;
  const rows = await db
    .update(renderJobs)
    .set(set)
    .where(and(eq(renderJobs.id, id), eq(renderJobs.status, from)))
    .returning({ id: renderJobs.id });
  return rows.length > 0;
}

// --- sweep 用 -------------------------------------------------------------

export async function findQueuedUpdatedBefore(beforeIso: string, limit: number) {
  return db
    .select({ id: renderJobs.id })
    .from(renderJobs)
    .where(and(eq(renderJobs.status, 'queued'), lt(renderJobs.updatedAt, beforeIso)))
    .orderBy(asc(renderJobs.updatedAt))
    .limit(limit);
}

export async function failRunningUpdatedBefore(beforeIso: string, patch: Patch, limit: number): Promise<string[]> {
  const stale = await db
    .select({ id: renderJobs.id })
    .from(renderJobs)
    .where(and(eq(renderJobs.status, 'running'), lt(renderJobs.updatedAt, beforeIso)))
    .limit(limit);
  const failed: string[] = [];
  for (const { id } of stale) {
    // 選択後に進捗が更新された（＝生きている）ジョブは除外するため updated_at も条件に入れる
    const rows = await db
      .update(renderJobs)
      .set(patch)
      .where(and(eq(renderJobs.id, id), eq(renderJobs.status, 'running'), lt(renderJobs.updatedAt, beforeIso)))
      .returning({ id: renderJobs.id });
    if (rows.length) failed.push(id);
  }
  return failed;
}

export async function findExpiredCompleted(nowIso: string, limit: number) {
  return db
    .select({ id: renderJobs.id, mp4Key: renderJobs.mp4Key, movKey: renderJobs.movKey })
    .from(renderJobs)
    .where(and(eq(renderJobs.status, 'completed'), eq(renderJobs.expired, 0), lte(renderJobs.expiresAt, nowIso)))
    .limit(limit);
}

export async function markJobExpired(id: string, nowIso: string): Promise<void> {
  await db
    .update(renderJobs)
    .set({ expired: 1, updatedAt: nowIso })
    .where(and(eq(renderJobs.id, id), eq(renderJobs.status, 'completed')));
}
