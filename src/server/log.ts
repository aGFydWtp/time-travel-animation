// 構造化ログ（1 行 JSON）。秘密情報（JWT、メールアドレス等）は渡さないこと。
export type LogFields = Record<string, string | number | boolean | null | undefined>;

export function logEvent(event: string, fields: LogFields = {}): void {
  console.log(JSON.stringify({ event, ts: new Date().toISOString(), ...fields }));
}

/** ログ用にエラーを短い文字列にする（スタックは出さない）。 */
export function errorSummary(err: unknown, max = 300): string {
  const name = err instanceof Error ? err.name : typeof err;
  const message = err instanceof Error ? err.message : String(err);
  return `${name}: ${message}`.slice(0, max);
}
