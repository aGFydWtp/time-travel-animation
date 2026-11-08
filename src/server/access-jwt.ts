// Cloudflare Access JWT の検証と認可判定。void/* を import しない純粋モジュール（鍵解決は注入）。
import { jwtVerify, type JWTVerifyGetKey } from 'jose';

export type AuthDecision =
  | { ok: true; ownerId: string }
  | {
      ok: false;
      status: 401 | 403 | 503;
      code: 'unauthorized' | 'forbidden' | 'auth_not_configured';
      message: string;
    };

export interface AuthInput {
  /** env.AUTH_MODE */
  mode: 'access' | 'dev';
  /** import.meta.env.DEV（開発ビルドのときだけ true） */
  isDevBuild: boolean;
  teamDomain: string | undefined;
  audience: string | undefined;
  /** env.ALLOWED_EMAILS（カンマ区切り）。未設定なら Access のポリシーのみに委ねる */
  allowedEmails: string | undefined;
  /** Cf-Access-Jwt-Assertion ヘッダー値 */
  token: string | null | undefined;
  /** チームドメインから鍵解決関数を得る（本番は createRemoteJWKSet、テストはローカル鍵） */
  getKey: (teamDomain: string) => JWTVerifyGetKey;
}

export const DEV_OWNER_ID = 'dev@localhost';

export function parseAllowedEmails(raw: string | undefined): Set<string> | null {
  if (raw === undefined) return null;
  const list = raw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  // 空文字列が設定されている場合は「誰も許可しない」（fail closed）
  return new Set(list);
}

/** `myteam.cloudflareaccess.com` / `https://myteam.cloudflareaccess.com/` のどちらでも受け付ける */
export function normalizeTeamDomain(raw: string): string {
  return raw
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/\/+$/, '');
}

export async function authenticate(input: AuthInput): Promise<AuthDecision> {
  if (input.mode === 'dev' && input.isDevBuild) {
    return { ok: true, ownerId: DEV_OWNER_ID };
  }

  const teamDomain = input.teamDomain ? normalizeTeamDomain(input.teamDomain) : '';
  const audience = input.audience?.trim() ?? '';
  if (!teamDomain || !audience) {
    return {
      ok: false,
      status: 503,
      code: 'auth_not_configured',
      message: '認証が設定されていません（ACCESS_TEAM_DOMAIN / ACCESS_AUD）',
    };
  }

  const token = input.token?.trim();
  if (!token) {
    return { ok: false, status: 401, code: 'unauthorized', message: '認証が必要です' };
  }

  let email: unknown;
  try {
    const { payload } = await jwtVerify(token, input.getKey(teamDomain), {
      issuer: `https://${teamDomain}`,
      audience,
      algorithms: ['RS256'],
      clockTolerance: 30,
    });
    email = payload.email;
  } catch {
    return { ok: false, status: 401, code: 'unauthorized', message: '認証トークンが無効です' };
  }

  if (typeof email !== 'string' || !email.includes('@')) {
    // サービストークン等、利用者を特定できないトークンは拒否
    return { ok: false, status: 403, code: 'forbidden', message: '利用者を特定できません' };
  }
  const normalized = email.trim().toLowerCase();

  const allowed = parseAllowedEmails(input.allowedEmails);
  if (allowed && !allowed.has(normalized)) {
    return { ok: false, status: 403, code: 'forbidden', message: 'このアカウントには権限がありません' };
  }
  return { ok: true, ownerId: normalized };
}
