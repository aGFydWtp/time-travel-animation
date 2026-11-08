// Export from the editor (/): inline status line for the job just started.
import { expect, test } from '@playwright/test';
import { DEFAULT_CONFIG } from '../../src/lib/renderer/types.ts';
import { completed, failed, makeJob, mockApi, openEditor, running } from './fixtures.ts';

test('export: queued → running → completed shows one status line with downloads', async ({ page }) => {
  const queued = makeJob({ id: 'job-new' });
  const api = await mockApi(page, {
    onCreate: () => ({ status: 202, body: { id: 'job-new', status: 'queued', reused: false } }),
    timelines: {
      'job-new': [queued, queued, running(queued, 40), running(queued, 80), completed(queued)],
    },
  });
  await openEditor(page);
  await expect(page.getByTestId('job-list')).toHaveCount(0); // no history list on the editor

  await page.getByRole('button', { name: '書き出す' }).click();
  await expect(page.getByTestId('export-job')).toBeVisible();
  await expect(page.getByTestId('export-notice')).toHaveCount(0); // one status line only

  const post = api.requests.find((r) => r.method === 'POST');
  expect((post?.body as { config: unknown }).config).toEqual(DEFAULT_CONFIG);
  expect((post?.body as { idempotencyKey?: string }).idempotencyKey).toBeTruthy();

  const status = page.getByTestId('export-job');
  await expect(status).toContainText('待機中');
  await expect(status).toContainText('書き出し中', { timeout: 15_000 });
  await expect(status.locator('progress')).toHaveAttribute('value', /^(40|80)$/);

  await expect(status).toHaveAttribute('data-status', 'completed', { timeout: 20_000 });
  await expect(status).toContainText('完了');
  await expect(status.getByTestId('download-mov')).toHaveText('透過MOVをダウンロード 362 MB');
  await expect(status.getByTestId('download-mp4')).toHaveText('確認用MP4をダウンロード 2.3 MB');
  await expect(status.getByTestId('download-mov')).toHaveAttribute('href', '/api/renders/job-new/assets/mov?download=1');
  await expect(status.getByTestId('download-mp4')).toHaveAttribute('href', '/api/renders/job-new/assets/mp4?download=1');
  await expect(status.getByRole('link', { name: '一覧を見る →' })).toHaveAttribute('href', '/history');
  await expect(page.getByText('確認用MP4と透過MOVを作成します')).toBeVisible();
});

test('editing stays possible while an export is running', async ({ page }) => {
  const queued = makeJob({ id: 'job-busy' });
  await mockApi(page, {
    onCreate: () => ({ status: 202, body: { id: 'job-busy', status: 'queued', reused: false } }),
    timelines: { 'job-busy': [running(queued, 10)] },
  });
  await openEditor(page);
  await page.getByTestId('export-button').click();
  await expect(page.getByTestId('export-job')).toContainText('書き出し中');

  await page.getByLabel('終了日').fill('2022-12-31');
  await page.getByTestId('seek').fill('449');
  await expect(page.getByTestId('current-date')).toHaveText('2022.12.31');
  await expect(page.getByTestId('export-button')).toBeEnabled();
});

test('failed export shows the reason inline and can be retried', async ({ page }) => {
  const bad = failed(makeJob({ id: 'job-bad' }));
  const retried = makeJob({ id: 'job-retry', attempt: 2 });
  const api = await mockApi(page, {
    onCreate: () => ({ status: 202, body: { id: 'job-bad', status: 'queued', reused: false } }),
    onRetry: () => ({ status: 202, body: { id: 'job-retry', status: 'queued', reused: false } }),
    timelines: { 'job-bad': [bad], 'job-retry': [retried] },
  });
  await openEditor(page);
  await page.getByTestId('export-button').click();

  const status = page.getByTestId('export-job');
  await expect(status).toContainText('失敗：動画のエンコードに失敗しました。');
  await status.getByRole('button', { name: 'もう一度書き出す' }).click();
  expect(api.requests.some((r) => r.method === 'POST' && r.path === '/api/renders/job-bad/retry')).toBe(true);
  await expect(status).toContainText('待機中');
});

test('a reused job is noted once', async ({ page }) => {
  await mockApi(page, {
    onCreate: () => ({ status: 200, body: { id: 'job-same', status: 'running', reused: true } }),
    timelines: { 'job-same': [running(makeJob({ id: 'job-same' }), 20)] },
  });
  await openEditor(page);
  await page.getByTestId('export-button').click();
  await expect(page.getByTestId('export-notice')).toHaveText('同じ設定の書き出しが進行中です');
  await expect(page.getByTestId('export-job')).toContainText('20%');
});

test('429 on export shows a rate-limit message', async ({ page }) => {
  await mockApi(page, {
    onCreate: () => ({
      status: 429,
      body: { error: { code: 'rate_limited', message: 'too many' } },
      headers: { 'retry-after': '20' },
    }),
  });
  await openEditor(page);
  await page.getByTestId('export-button').click();
  await expect(page.getByTestId('export-notice')).toContainText('書き出しの上限に達しています');
  await expect(page.getByTestId('export-notice')).toContainText('約 20 秒後');
});

test('resubmitting the same config after a server error reuses the idempotency key', async ({ page }) => {
  let calls = 0;
  const queued = makeJob({ id: 'job-idem' });
  const api = await mockApi(page, {
    onCreate: () =>
      ++calls === 1
        ? { status: 503, body: { error: { code: 'internal', message: 'unavailable' } } }
        : { status: 202, body: { id: 'job-idem', status: 'queued', reused: false } },
    timelines: { 'job-idem': [completed(queued)] },
  });
  await openEditor(page);
  const keys = () =>
    api.requests.filter((r) => r.method === 'POST').map((r) => (r.body as { idempotencyKey: string }).idempotencyKey);

  await page.getByTestId('export-button').click();
  await expect(page.getByTestId('export-notice')).toContainText('サーバーでエラーが発生しました');
  await page.getByTestId('export-button').click();
  await expect(page.getByTestId('export-job')).toContainText('完了');
  expect(keys()).toHaveLength(2);
  expect(keys()[1]).toBe(keys()[0]);

  // A different config gets a new key.
  await page.getByLabel('長さ').fill('10');
  await page.getByTestId('export-button').click();
  await expect.poll(() => keys().length).toBe(3);
  expect(keys()[2]).not.toBe(keys()[0]);
});

test('/?from=<id> loads that job into the editor; a missing job is reported', async ({ page }) => {
  const config = { ...DEFAULT_CONFIG, fps: 24 as const, color: '#00FF00', endDate: '2023-07-01' };
  await mockApi(page, { list: [completed(makeJob({ id: 'job-done', config }))] });

  await page.goto('/?from=job-done');
  await expect(page.getByTestId('export-notice')).toHaveText('設定を読み込みました');
  await expect(page.getByLabel('FPS', { exact: true })).toHaveValue('24');
  await expect(page.getByLabel('文字色', { exact: true })).toHaveValue('#00FF00');
  await expect(page.getByLabel('終了日')).toHaveValue('2023-07-01');

  await page.goto('/?from=job-missing');
  await expect(page.getByTestId('export-notice')).toHaveText('指定された書き出しが見つかりませんでした');
  await expect(page.getByLabel('終了日')).toHaveValue('2020-01-01');
});
