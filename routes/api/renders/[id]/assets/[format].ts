// GET /api/renders/:id/assets/:format（mp4|mov）。R2 から Range 対応でストリーム配信する Worker プロキシ。
import { defineHandler } from 'void';
import { storage } from 'void/storage';
import { requireUser } from '../../../../../src/server/auth.ts';
import { ApiError, handleApi } from '../../../../../src/server/errors.ts';
import { decideAssetAccess, downloadFileName, isAssetFormat } from '../../../../../src/server/job-state.ts';
import { findOwnedJob } from '../../../../../src/server/jobs-repo.ts';
import { contentRangeHeader, etagMatches, parseRange } from '../../../../../src/server/range.ts';
import { requireJobId } from '../../../../../src/server/request.ts';

export const GET = defineHandler((c) =>
  handleApi('GET /api/renders/:id/assets/:format', async () => {
    const { ownerId } = await requireUser(c);
    const id = requireJobId(c.req.param('id'));
    const format = c.req.param('format');
    const row = await findOwnedJob(id, ownerId);
    const access = decideAssetAccess(row, ownerId, format, new Date());
    if (!access.ok) throw new ApiError(access.status, access.code, access.message);

    const head = await storage.head(access.key);
    if (!head) throw new ApiError(404, 'not_found', 'ファイルが見つかりません');

    const headers = new Headers({
      'content-type': access.contentType,
      'accept-ranges': 'bytes',
      etag: head.httpEtag,
      'cache-control': 'private, max-age=300',
      'x-content-type-options': 'nosniff',
    });
    if (c.req.query('download') === '1' && isAssetFormat(format)) {
      headers.set('content-disposition', `attachment; filename="${downloadFileName(id, format)}"`);
    }

    if (etagMatches(c.req.header('if-none-match'), head.httpEtag)) {
      return new Response(null, { status: 304, headers });
    }

    const range = parseRange(c.req.header('range'), head.size);
    if (range.kind === 'unsatisfiable') {
      headers.set('content-range', `bytes */${head.size}`);
      return new Response(null, { status: 416, headers });
    }

    const obj = await storage.get(
      access.key,
      range.kind === 'partial' ? { range: { offset: range.start, length: range.length } } : {},
    );
    if (!obj) throw new ApiError(404, 'not_found', 'ファイルが見つかりません');

    if (range.kind === 'partial') {
      headers.set('content-range', contentRangeHeader(range.start, range.end, head.size));
      headers.set('content-length', String(range.length));
      return new Response(obj.body, { status: 206, headers });
    }
    headers.set('content-length', String(head.size));
    return new Response(obj.body, { status: 200, headers });
  }),
);
