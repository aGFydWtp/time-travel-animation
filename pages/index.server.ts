import { defineHead } from 'void';

export const head = defineHead(() => ({
  title: '日付アニメーション',
  htmlAttrs: { lang: 'ja' },
  meta: [
    {
      name: 'description',
      content: '開始日から終了日へ日付が切り替わる動画を作成し、確認用MP4と透過MOV（ProRes 4444）を書き出します。',
    },
  ],
}));
