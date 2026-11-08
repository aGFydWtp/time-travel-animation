// リクエストボディの検証（純粋モジュール）。
import { z } from 'zod';
import { safeParseRenderConfig, type RenderConfig } from '../lib/renderer/index.ts';
import { MAX_REQUEST_BODY_BYTES } from './constants.ts';
import { ApiError, type ApiIssue } from './errors.ts';

const createBodySchema = z.strictObject({
  config: z.unknown(),
  idempotencyKey: z
    .string()
    .min(8)
    .max(128)
    .regex(/^[A-Za-z0-9._:-]+$/, { message: 'idempotencyKey は英数字と ._:- のみ' })
    .optional(),
});

function toIssues(issues: readonly { path: PropertyKey[]; message: string }[], prefix: (string | number)[] = []): ApiIssue[] {
  return issues.slice(0, 20).map((i) => ({
    path: [...prefix, ...i.path.filter((p): p is string | number => typeof p !== 'symbol')],
    message: i.message,
  }));
}

export interface CreateRequest {
  config: RenderConfig;
  idempotencyKey: string | null;
}

/** POST /api/renders のボディ（JSON 文字列）を検証・正規化する。不正なら ApiError(400)。 */
export function parseCreateRequest(rawBody: string): CreateRequest {
  if (new TextEncoder().encode(rawBody).length > MAX_REQUEST_BODY_BYTES) {
    throw new ApiError(400, 'invalid_request', 'リクエストが大きすぎます');
  }
  let json: unknown;
  try {
    json = JSON.parse(rawBody);
  } catch {
    throw new ApiError(400, 'invalid_request', 'JSON として解釈できません');
  }
  const body = createBodySchema.safeParse(json);
  if (!body.success) {
    throw new ApiError(400, 'invalid_request', 'リクエストの形式が不正です', { issues: toIssues(body.error.issues) });
  }
  const config = safeParseRenderConfig(body.data.config);
  if (!config.success) {
    throw new ApiError(400, 'invalid_request', '設定値が不正です', {
      issues: toIssues(config.error.issues, ['config']),
    });
  }
  return { config: config.data, idempotencyKey: body.data.idempotencyKey ?? null };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 形式不正な id は存在しないものとして 404 にする */
export function requireJobId(raw: string | undefined): string {
  if (!raw || !UUID_RE.test(raw)) throw new ApiError(404, 'not_found', 'ジョブが見つかりません');
  return raw.toLowerCase();
}
