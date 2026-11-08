import { defineHandler, defineHead, type InferProps } from 'void';

export const loader = defineHandler(() => {
  return { title: 'Date Countdown Studio' };
});

export type Props = InferProps<typeof loader>;

export const head = defineHead(() => ({
  title: 'Date Countdown Studio',
  htmlAttrs: { lang: 'ja' },
}));
