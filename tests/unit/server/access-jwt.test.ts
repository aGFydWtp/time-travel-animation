import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWTVerifyGetKey } from 'jose';
import { beforeAll, describe, expect, it } from 'vitest';
import { authenticate, DEV_OWNER_ID, parseAllowedEmails, type AuthInput } from '../../../src/server/access-jwt.ts';

const TEAM = 'myteam.cloudflareaccess.com';
const AUD = 'aud-tag-123';

let getKey: (team: string) => JWTVerifyGetKey;
let privateKey: CryptoKey;
let otherPrivateKey: CryptoKey;

beforeAll(async () => {
  const pair = await generateKeyPair('RS256');
  privateKey = pair.privateKey;
  otherPrivateKey = (await generateKeyPair('RS256')).privateKey;
  const jwk = { ...(await exportJWK(pair.publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' };
  const jwks = createLocalJWKSet({ keys: [jwk] });
  getKey = () => jwks;
});

async function sign(
  claims: Record<string, unknown>,
  opts: { iss?: string; aud?: string; exp?: string | number; key?: CryptoKey } = {},
) {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
    .setIssuer(opts.iss ?? `https://${TEAM}`)
    .setAudience(opts.aud ?? AUD)
    .setIssuedAt()
    .setExpirationTime(opts.exp ?? '5m')
    .sign(opts.key ?? privateKey);
}

function input(token: string | undefined, over: Partial<AuthInput> = {}): AuthInput {
  return {
    mode: 'access',
    isDevBuild: false,
    teamDomain: TEAM,
    audience: AUD,
    allowedEmails: undefined,
    token,
    getKey,
    ...over,
  };
}

describe('authenticate (Cloudflare Access JWT)', () => {
  it('accepts a valid token and uses the lowercased email as owner', async () => {
    const token = await sign({ email: 'User@Example.com' });
    expect(await authenticate(input(token))).toEqual({ ok: true, ownerId: 'user@example.com' });
  });

  it('accepts team domain given with scheme and trailing slash', async () => {
    const token = await sign({ email: 'a@example.com' });
    const r = await authenticate(input(token, { teamDomain: `https://${TEAM}/` }));
    expect(r.ok).toBe(true);
  });

  it('rejects an expired token with 401', async () => {
    const token = await sign({ email: 'a@example.com' }, { exp: Math.floor(Date.now() / 1000) - 3600 });
    expect(await authenticate(input(token))).toMatchObject({ ok: false, status: 401, code: 'unauthorized' });
  });

  it('rejects a wrong audience with 401', async () => {
    const token = await sign({ email: 'a@example.com' }, { aud: 'other-aud' });
    expect(await authenticate(input(token))).toMatchObject({ ok: false, status: 401 });
  });

  it('rejects a wrong issuer with 401', async () => {
    const token = await sign({ email: 'a@example.com' }, { iss: 'https://evil.cloudflareaccess.com' });
    expect(await authenticate(input(token))).toMatchObject({ ok: false, status: 401 });
  });

  it('rejects a token signed by an unknown key with 401', async () => {
    const token = await sign({ email: 'a@example.com' }, { key: otherPrivateKey });
    expect(await authenticate(input(token))).toMatchObject({ ok: false, status: 401 });
  });

  it('rejects a missing or garbage token with 401', async () => {
    expect(await authenticate(input(undefined))).toMatchObject({ ok: false, status: 401 });
    expect(await authenticate(input('not.a.jwt'))).toMatchObject({ ok: false, status: 401 });
  });

  it('rejects tokens without an email (e.g. service tokens) with 403', async () => {
    const token = await sign({ common_name: 'svc' });
    expect(await authenticate(input(token))).toMatchObject({ ok: false, status: 403, code: 'forbidden' });
  });

  it('enforces ALLOWED_EMAILS case-insensitively', async () => {
    const allowedEmails = ' Owner@Example.com , second@example.com ';
    const ok = await sign({ email: 'owner@example.com' });
    const ng = await sign({ email: 'intruder@example.com' });
    expect(await authenticate(input(ok, { allowedEmails }))).toEqual({ ok: true, ownerId: 'owner@example.com' });
    expect(await authenticate(input(ng, { allowedEmails }))).toMatchObject({ ok: false, status: 403, code: 'forbidden' });
  });

  it('treats an empty ALLOWED_EMAILS as "nobody" (fail closed)', async () => {
    const token = await sign({ email: 'a@example.com' });
    expect(await authenticate(input(token, { allowedEmails: '' }))).toMatchObject({ ok: false, status: 403 });
  });

  it('fails closed with 503 when Access is not configured', async () => {
    const token = await sign({ email: 'a@example.com' });
    expect(await authenticate(input(token, { teamDomain: undefined }))).toMatchObject({
      ok: false,
      status: 503,
      code: 'auth_not_configured',
    });
    expect(await authenticate(input(token, { audience: '' }))).toMatchObject({ status: 503 });
  });

  it('uses the dev owner only when AUTH_MODE=dev AND the build is a dev build', async () => {
    expect(await authenticate(input(undefined, { mode: 'dev', isDevBuild: true }))).toEqual({
      ok: true,
      ownerId: DEV_OWNER_ID,
    });
    // 本番ビルドで AUTH_MODE=dev が残っていても検証をスキップしない
    expect(
      await authenticate(input(undefined, { mode: 'dev', isDevBuild: false, teamDomain: undefined })),
    ).toMatchObject({ ok: false, status: 503 });
    expect(await authenticate(input(undefined, { mode: 'dev', isDevBuild: false }))).toMatchObject({
      ok: false,
      status: 401,
    });
  });

  it('does not trust plain identity headers (only the verified JWT counts)', async () => {
    // AuthInput にはトークン以外の利用者情報を渡す経路が無い
    expect(await authenticate(input(''))).toMatchObject({ ok: false, status: 401 });
  });
});

describe('parseAllowedEmails', () => {
  it('returns null when unset and a normalized set otherwise', () => {
    expect(parseAllowedEmails(undefined)).toBeNull();
    expect([...parseAllowedEmails('A@x.com,,b@y.com ')!]).toEqual(['a@x.com', 'b@y.com']);
  });
});
