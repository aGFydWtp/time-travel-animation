# Date Countdown Studio — 実装設計メモ（仕様書からの確定事項）

仕様: `/Users/haruki/Downloads/date-countdown-studio-spec.md`（以下「仕様」）
Void API 調査: `claudedocs/void-research.md`（void@1.6.2 / @void/svelte 1.6.2 / @cloudflare/sandbox 1.0.3）

## 仕様からの変更点（Void の実制約による）

1. **Sandbox は R2/D1 に直接触れない。** Queue consumer（Worker）が
   sandbox 内でレンダリング → `files.stat()` + `files.readFile()` → `storage.put()` → `db.update()` を行う。
   R2 `put()` は長さ不明ストリームを拒否するので `FixedLengthStream(size)` に pipe する。
2. **Queue consumer は 15 分で打ち切られる。** そのため `start` メッセージで render-entry を sandbox 内でデタッチ起動し、
   `poll` メッセージ（約 10 秒ごとの遅延送信）で progress.json / result.json を読んで進捗更新・完了時アップロードを行う（ユーザー決定 2026-11-08）。
   1 回の consumer 実行は短く保つ。heartbeat（5 秒）が 3 分途絶 → `stalled`、ジョブ全体 2 時間で `timeout`。
3. **DLQ なし。** D1 を状態の真実の源泉にする。`maxBatchSize = 1`、状態遷移は比較更新（CAS）。
   cron（`crons/sweep.ts`）が取り残された `queued`（Queue 送信失敗）を再送し、期限切れ `running` を `failed` にする。
4. **ダウンロードは Worker プロキシ（Range 対応）。** 署名 URL（S3 クレデンシャル）は使わない。仕様 §3.1-7 で許容される方式。
5. **Sandbox はインターネット無効（既定）。** レンダリングページ・フォント・スクリプトは全てイメージに焼き込む。

## 共有レンダラー（単一の真実の源泉）

- `src/lib/renderer/` … `RenderConfig` / calendar / easing / `getTotalFrames` / `getDateAtFrame` / `renderFrame` / fonts / Zod schema。
- ブラウザ UI は Vite 経由で import。
- コンテナは `scripts/build-container.ts`（esbuild）で同じソースを `container/dist/render-page.js` にバンドルし、
  `container/render-page.html` から読み込む。Dockerfile はビルド済み `container/dist` とフォントを COPY する。

## コンテナ（Phase 2）

- `Dockerfile.sandbox`: `cloudflare/sandbox:1.0.3` から `sandbox-shim` を COPY（void-research.md 参照）、
  Node + playwright-core + Chromium（Debian パッケージ or Playwright 同梱）+ ffmpeg/ffprobe + フォント + `container/dist`。
- エントリ: `node /app/render-entry.js --config /work/<job>/config.json --out /work/<job>/out`
  - Chromium で render-page.html を開き `document.fonts.ready` を待つ → `page.evaluate` でフレーム毎に `renderFrame` → 透過 PNG を 1 枚ずつディスクへ（`frame_%05d.png`）。
  - ffmpeg（引数配列）: MP4 = H.264 yuv420p, `stageColor(config)` の色に合成（`background` が `'transparent'` なら `backdropFor(color)`：白文字なら黒、黒文字なら白。`#RRGGBB` ならその色）, `+faststart` / MOV = `prores_ks -profile:v 4`。透過は `-pix_fmt yuva444p10le -alpha_bits 16`、色付きは MP4 と同じ色に合成した不透明の `yuv444p10le`（アルファなし。4:4:4 でクロマキーの縁がきれい）。
  - verify-output: ffprobe（尺・fps・サイズ・codec・pix_fmt）。透過は MOV の代表フレームを RGBA デコードして alpha=0 背景 / alpha>0 文字を確認。色付きは MOV の pix_fmt にアルファが無いことと、MOV・MP4 の四隅が選んだ色（チャンネル毎 ±6。`#00FF00` の実測は (0,255,1)）であることを確認。
  - `background` が `'transparent'` のときは正規形（ハッシュ・`config_json`・コンテナに渡す設定）からキーを省き、既存ジョブのハッシュを保つ。
  - 結果を `out/result.json`（ファイルサイズ、検証結果）に書き、進捗は `out/progress.json`。
  - PNG 中間ファイルは終了時に削除。
- ローカル CLI: `pnpm render:local <config.json> <outDir>` が同じイメージを `docker run` して短い動画を作る（Phase 2 受け入れ）。

## バックエンド（Phase 3）

- D1 `render_jobs`（仕様 §7 の全カラム + `expires_at`）、インデックス: `owner_id+created_at`, `status`, `owner_id+config_hash`。
- API（全て認証必須、`src/server/auth.ts`）
  - `POST /api/renders` → Zod 再検証 → 進行中の同一 config_hash ジョブがあれば再利用（200 で既存を返す）→ ユーザーの進行中ジョブが 1 件以上なら 429 → 作成 → `queues.render.send({ jobId })` → 202。送信失敗時もジョブは `queued` のまま残り、cron が再送。
  - `GET /api/renders?cursor=&limit=`（最新順、owner で絞る）
  - `GET /api/renders/:id`（他人のジョブは 404）
  - `GET /api/renders/:id/assets/:format`（mp4|mov、completed のみ、Range 対応、`Content-Type`、`?download=1` で `Content-Disposition: attachment`）
  - `POST /api/renders/:id/retry`（failed のみ、新ジョブ作成）
- 認証: 本番は Cloudflare Access JWT（`Cf-Access-Jwt-Assertion`）を `jose` で JWKS 検証（`https://<ACCESS_TEAM_DOMAIN>/cdn-cgi/access/certs`, aud=`ACCESS_AUD`）、owner_id=email。
  さらにアプリ側でも `ALLOWED_EMAILS`（カンマ区切り env、本番値はユーザー指定の 1 アドレス）に含まれない email は 403（多層防御）。
  `ACCESS_TEAM_DOMAIN` / `ACCESS_AUD` 未設定の本番ではジョブ作成を含む全 API を 503 で拒否（設定前に誰も実行できない）。
  `AUTH_MODE=dev` かつ開発ビルド（`import.meta.env.DEV`）のときだけ `dev@localhost` 固定。
- R2 キー: `renders/<ownerHash>/<jobId>/preview.mp4|transparent.mov|metadata.json`（ownerHash = SHA-256(owner_id) の先頭 16 桁。ユーザー文字列をそのままパスに入れない）。
- 保持: 30 日。cron が期限切れの R2 オブジェクトを削除し、DB を `expired` 表示にする（R2 Lifecycle も README に記載）。

## UI

- `pages/index.svelte` 1 画面（エディター + 書き出し履歴）。デスクトップ 2 カラム / モバイル縦。
- プレビュー Canvas の内部解像度 = 出力解像度。背景（選んだ背景色。透過なら文字色に応じて黒か白、`stageColor`）は CSS 背景のみ。
- 再生は `performance.now()` から経過時間 → `frame = floor(t * fps)`（描画間引きでも時間ベース）。
- ジョブのポーリング 2 秒、指数バックオフ（最大 10 秒）。
- 完了ジョブの設定ハッシュが現在の設定と違えば「現在の設定とは異なる」と表示。
