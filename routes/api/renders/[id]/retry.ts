// POST /api/renders/:id/retry（failed のみ。設定を複製した新ジョブを作る。元ジョブはそのまま残す）
import { defineHandler } from 'void';
import { safeParseRenderConfig } from '../../../../src/lib/renderer/index.ts';
import { requireUser } from '../../../../src/server/auth.ts';
import { ApiError, handleApi, jsonResponse } from '../../../../src/server/errors.ts';
import { findOwnedJob } from '../../../../src/server/jobs-repo.ts';
import { createRenderJob } from '../../../../src/server/jobs-service.ts';
import { logEvent } from '../../../../src/server/log.ts';
import { requireJobId } from '../../../../src/server/request.ts';

export const POST = defineHandler((c) =>
  handleApi('POST /api/renders/:id/retry', async () => {
    const { ownerId } = await requireUser(c);
    const id = requireJobId(c.req.param('id'));
    const row = await findOwnedJob(id, ownerId);
    if (!row) throw new ApiError(404, 'not_found', 'ジョブが見つかりません');
    if (row.status !== 'failed') {
      throw new ApiError(409, 'conflict', '失敗したジョブだけ再試行できます');
    }
    // 保存済み設定も現行のスキーマで再検証する（スキーマ変更後の古いジョブ対策）
    const parsed = safeParseRenderConfig(JSON.parse(row.configJson));
    if (!parsed.success) throw new ApiError(409, 'conflict', 'このジョブの設定は現在のバージョンでは再試行できません');

    const result = await createRenderJob(ownerId, parsed.data, null);
    logEvent('render.retry', { jobId: result.body.id, retryOf: id, reused: result.body.reused });
    return jsonResponse(result.body, result.status);
  }),
);
