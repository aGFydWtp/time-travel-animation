// Queue `render` のメッセージ形式（純粋モジュール）。
//   start: queued → running にしてコンテナで描画をバックグラウンド起動する
//   poll : コンテナの状態を確認し、進捗の反映 / アップロード / 失敗判定を行う（遅延メッセージで自分を再送）
export type RenderMessage = { type: 'start'; jobId: string } | { type: 'poll'; jobId: string };

const JOB_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isJobId(v: unknown): v is string {
  return typeof v === 'string' && JOB_ID_RE.test(v);
}

/** 不正なら null。`type` の無い旧形式 `{ jobId }` は start とみなす（デプロイ前に積まれたメッセージ用）。 */
export function parseRenderMessage(body: unknown): RenderMessage | null {
  if (!body || typeof body !== 'object') return null;
  const { type, jobId } = body as { type?: unknown; jobId?: unknown };
  if (!isJobId(jobId)) return null;
  const id = jobId.toLowerCase();
  if (type === undefined || type === 'start') return { type: 'start', jobId: id };
  if (type === 'poll') return { type: 'poll', jobId: id };
  return null;
}
