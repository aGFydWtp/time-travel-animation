// 全 API 共通の認証。Cloudflare Access の JWT を JWKS で検証する（ヘッダー値を無条件に信頼しない）。
import { createRemoteJWKSet, type JWTVerifyGetKey } from 'jose';
import { env } from 'void/env';
import { authenticate } from './access-jwt.ts';
import { ApiError } from './errors.ts';

export interface AuthUser {
  ownerId: string;
}

interface RequestLike {
  req: { header(name: string): string | undefined };
}

// isolate 内でキャッシュ（jose が鍵のキャッシュと再取得を管理する）
const jwksCache = new Map<string, JWTVerifyGetKey>();

function remoteJwks(teamDomain: string): JWTVerifyGetKey {
  let jwks = jwksCache.get(teamDomain);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(`https://${teamDomain}/cdn-cgi/access/certs`));
    jwksCache.set(teamDomain, jwks);
  }
  return jwks;
}

/** 認証済み利用者を返す。失敗時は ApiError(401/403/503) を投げる。 */
export async function requireUser(c: RequestLike): Promise<AuthUser> {
  const decision = await authenticate({
    mode: env.AUTH_MODE,
    isDevBuild: import.meta.env.DEV === true,
    teamDomain: env.ACCESS_TEAM_DOMAIN,
    audience: env.ACCESS_AUD,
    allowedEmails: env.ALLOWED_EMAILS,
    token: c.req.header('cf-access-jwt-assertion'),
    getKey: remoteJwks,
  });
  if (!decision.ok) throw new ApiError(decision.status, decision.code, decision.message);
  return { ownerId: decision.ownerId };
}
