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
  // Cloudflare の vCPU はこの Mac のコアより遅い可能性があるため、RENDER_TIMEOUT_MS（12 分）に対して
  // 2.6 倍の余裕しかない standard-1 ではなく、約 5 倍の余裕がある standard-2 を使う。
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
