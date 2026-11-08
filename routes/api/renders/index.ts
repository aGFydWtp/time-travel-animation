// GET /api/renders（履歴一覧） / POST /api/renders（書き出しジョブ作成）
import { defineHandler } from 'void';
import type { ListRendersResponse } from '../../../src/lib/api/types.ts';
import { requireUser } from '../../../src/server/auth.ts';
import { LIST_DEFAULT_LIMIT, LIST_MAX_LIMIT } from '../../../src/server/constants.ts';
import { decodeCursor, encodeCursor, parseLimit } from '../../../src/server/cursor.ts';
import { ApiError, handleApi, jsonResponse } from '../../../src/server/errors.ts';
import { toRenderJob } from '../../../src/server/job-state.ts';
import { listOwnedJobs } from '../../../src/server/jobs-repo.ts';
import { createRenderJob } from '../../../src/server/jobs-service.ts';
import { parseCreateRequest } from '../../../src/server/request.ts';

export const GET = defineHandler((c) =>
  handleApi('GET /api/renders', async () => {
    const { ownerId } = await requireUser(c);
    const limit = parseLimit(c.req.query('limit'), LIST_DEFAULT_LIMIT, LIST_MAX_LIMIT);
    if (limit === null) throw new ApiError(400, 'invalid_request', 'limit が不正です');
    const rawCursor = c.req.query('cursor');
    const cursor = rawCursor ? decodeCursor(rawCursor) : null;
    if (rawCursor && !cursor) throw new ApiError(400, 'invalid_request', 'cursor が不正です');

    // 1 件多く取って次ページの有無を判定する
    const rows = await listOwnedJobs(ownerId, cursor, limit + 1);
    const page = rows.slice(0, limit);
    const last = page.at(-1);
    const now = new Date();
    const body: ListRendersResponse = {
      items: page.map((r) => toRenderJob(r, now)),
      nextCursor: rows.length > limit && last ? encodeCursor({ createdAt: last.createdAt, id: last.id }) : null,
    };
    return jsonResponse(body);
  }),
);

export const POST = defineHandler((c) =>
  handleApi('POST /api/renders', async () => {
    const { ownerId } = await requireUser(c);
    const req = parseCreateRequest(await c.req.text());
    const result = await createRenderJob(ownerId, req.config, req.idempotencyKey);
    return jsonResponse(result.body, result.status);
  }),
);
