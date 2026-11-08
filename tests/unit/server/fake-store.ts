// render_jobs の CAS 意味論を真似たインメモリ実装（テスト専用）。
import { DEFAULT_CONFIG } from '../../../src/lib/renderer/index.ts';
import { canonicalConfigString } from '../../../src/lib/renderer/index.ts';
import { newJobValues, type JobRow } from '../../../src/server/job-state.ts';

export const OWNER = 'owner@example.com';

let seq = 0;
export function makeJob(over: Partial<JobRow> = {}, now = new Date('2026-11-08T00:00:00.000Z')): JobRow {
  seq++;
  const id = over.id ?? `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`;
  return {
    ...newJobValues({
      id,
      ownerId: OWNER,
      configJson: canonicalConfigString(DEFAULT_CONFIG),
      configHash: 'hash-default',
      idempotencyKey: null,
      now,
    }),
    ...over,
  };
}

export class FakeJobStore {
  rows = new Map<string, JobRow>();

  add(row: JobRow): JobRow {
    this.rows.set(row.id, { ...row });
    return row;
  }

  get(id: string): JobRow {
    const r = this.rows.get(id);
    if (!r) throw new Error(`no row ${id}`);
    return r;
  }

  async claim(id: string, patch: Partial<JobRow>): Promise<JobRow | null> {
    const r = this.rows.get(id);
    if (!r || r.status !== 'queued') return null;
    Object.assign(r, patch, { attempt: r.attempt + 1 });
    return { ...r };
  }

  async updateIf(
    id: string,
    from: string,
    patch: Partial<JobRow>,
    opts: { decrementAttempt?: boolean } = {},
  ): Promise<boolean> {
    const r = this.rows.get(id);
    if (!r || r.status !== from) return false;
    Object.assign(r, patch);
    if (opts.decrementAttempt) r.attempt = Math.max(0, r.attempt - 1);
    return true;
  }
}
