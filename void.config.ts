import { defineConfig } from 'void/config';

export default defineConfig({
  routing: {
    typedRoutes: true,
  },
  worker: {
    compatibility_date: '2026-02-24',
  },
  head: {
    title: 'Date Countdown Studio',
    htmlAttrs: { lang: 'ja' },
    meta: [{ name: 'viewport', content: 'width=device-width, initial-scale=1' }],
  },
  // TODO: Dockerfile.sandbox（Chromium + FFmpeg）ができたらコメントを外す。
  // 宣言すると `pnpm dev` 起動時に Docker でイメージをビルドするため、ファイルが無いと ENOENT で落ちる。
  // sandbox: {
  //   image: './Dockerfile.sandbox',
  //   instanceType: 'standard-2',
  // },
  cloudflare: {
    name: 'time-travel-animation',
    observability: { enabled: true },
    // 公開範囲を Void に勝手に変えさせないよう明示する
    workers_dev: true,
    preview_urls: false,
    routes: [],
  },
});
