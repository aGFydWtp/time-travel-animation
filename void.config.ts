import { defineConfig } from 'void/config';

export default defineConfig({
  routing: {
    typedRoutes: true,
  },
  worker: {
    compatibility_date: '2026-02-24',
  },
  head: {
    title: '日付アニメーション',
    htmlAttrs: { lang: 'ja' },
    meta: [{ name: 'viewport', content: 'width=device-width, initial-scale=1' }],
  },
  // Chromium + FFmpeg の描画用イメージ。`pnpm dev` / `pnpm run deploy` は先に `pnpm build:container`
  // で container/dist を作る（イメージが COPY する。gitignore 対象）。
  // ローカルでも Cloudflare の制約どおり linux/amd64 でビルド・実行される（Apple Silicon ではエミュレーション）。
  // standard-2 = 1 vCPU / 6 GiB。受け入れ条件（450 フレーム 1080p）の実測（Apple Silicon 上の docker --cpus）は
  // 1 vCPU で約 140 秒（大半は ProRes エンコード）・ピーク約 1.3 GB、0.5 vCPU（standard-1 相当）で約 270 秒。
  // 描画はコンテナ内でバックグラウンド実行し、Queue consumer が約 10 秒毎の poll で進捗を確認するため、
  // consumer の 15 分上限は尺を縛らない（ジョブ全体の上限は MAX_RENDER_MS = 2 時間）。Cloudflare の vCPU は
  // この Mac のコアより遅い可能性があるため、書き出し時間を短くする目的で standard-1 ではなく standard-2 を使う。
  sandbox: {
    image: './Dockerfile.sandbox',
    instanceType: 'standard-2',
  },
  cloudflare: {
    name: 'time-travel-animation',
    observability: { enabled: true },
    // 公開範囲を Void に勝手に変えさせないよう明示する
    workers_dev: true,
    preview_urls: false,
    routes: [],
  },
});
