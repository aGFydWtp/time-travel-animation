import { defineEnv, oneOf, string } from 'void/env';

export default defineEnv({
  /** Cloudflare Access のチームドメイン（例: myteam.cloudflareaccess.com）。AUTH_MODE=access で必須 */
  ACCESS_TEAM_DOMAIN: string().optional(),
  /** Cloudflare Access アプリケーションの AUD タグ。AUTH_MODE=access で必須 */
  ACCESS_AUD: string().optional(),
  /** 'access' = Cf-Access-Jwt-Assertion を検証する / 'dev' = ローカル開発用に検証をスキップ */
  AUTH_MODE: oneOf(['access', 'dev']).default('access'),
  /** アプリ側の許可リスト（カンマ区切りメール、大文字小文字無視）。設定時はこれに無い email を 403 にする */
  ALLOWED_EMAILS: string().optional(),
  /** R2 に置いた書き出しファイルの保持日数 */
  R2_RETENTION_DAYS: string().default('30'),
});
