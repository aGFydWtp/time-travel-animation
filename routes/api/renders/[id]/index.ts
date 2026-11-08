// GET /api/renders/:id（他人のジョブは 404）
import { defineHandler } from 'void';
import { requireUser } from '../../../../src/server/auth.ts';
import { ApiError, handleApi, jsonResponse } from '../../../../src/server/errors.ts';
import { toRenderJob } from '../../../../src/server/job-state.ts';
import { findOwnedJob } from '../../../../src/server/jobs-repo.ts';
import { requireJobId } from '../../../../src/server/request.ts';

export const GET = defineHandler((c) =>
  handleApi('GET /api/renders/:id', async () => {
    const { ownerId } = await requireUser(c);
    const id = requireJobId(c.req.param('id'));
    const row = await findOwnedJob(id, ownerId);
    if (!row) throw new ApiError(404, 'not_found', 'ジョブが見つかりません');
    return jsonResponse(toRenderJob(row, new Date()));
  }),
);
