import { expect, test } from '@playwright/test';
import { DEFAULT_CONFIG } from '../../src/lib/renderer/types.ts';
import { completed, failed, makeJob, mockApi, openEditor, running } from './fixtures.ts';

test('export: queued → running → completed with inline MP4 and downloads', async ({ page }) => {
  const queued = makeJob({ id: 'job-new' });
  const api = await mockApi(page, {
    onCreate: () => ({ status: 202, body: { id: 'job-new', status: 'queued', reused: false } }),
    timelines: {
      'job-new': [queued, queued, running(queued, 40), running(queued, 80), completed(queued)],
    },
  });
  await openEditor(page);
  await expect(page.getByText('まだ書き出しはありません')).toBeVisible();

  await page.getByTestId('export-button').click();
  await expect(page.getByTestId('export-notice')).toContainText('書き出しを開始しました');

  const post = api.requests.find((r) => r.method === 'POST');
  expect((post?.body as { config: unknown }).config).toEqual(DEFAULT_CONFIG);
  expect((post?.body as { idempotencyKey?: string }).idempotencyKey).toBeTruthy();

  const item = page.locator('[data-job-id="job-new"]');
  await expect(item.getByTestId('job-status')).toHaveText('待機中');
  await expect(item.getByTestId('job-status')).toHaveText('処理中', { timeout: 15_000 });
  await expect(item.getByTestId('job-stage')).toHaveText('フレーム描画中');
  await expect(item.locator('progress')).toHaveAttribute('value', /^(40|80)$/);

  await expect(item.getByTestId('job-status')).toHaveText('完了', { timeout: 20_000 });
  await expect(item.getByTestId('job-video')).toHaveAttribute('src', '/api/renders/job-new/assets/mp4');
  await expect(item.getByTestId('download-mp4')).toHaveAttribute('href', '/api/renders/job-new/assets/mp4?download=1');
  await expect(item.getByTestId('download-mov')).toHaveAttribute('href', '/api/renders/job-new/assets/mov?download=1');
  await expect(item.getByText('ProRes 4444')).toBeVisible();

  // Same config → no badge; editing the config → "differs" badge.
  await expect(item.getByTestId('job-differs')).toHaveCount(0);
  await page.getByLabel('文字色', { exact: true }).fill('#FF0000');
  await expect(item.getByTestId('job-differs')).toHaveText('現在の設定とは異なる');
});

test('editing stays possible while an export is running', async ({ page }) => {
  const queued = makeJob({ id: 'job-busy' });
  await mockApi(page, {
    onCreate: () => ({ status: 202, body: { id: 'job-busy', status: 'queued', reused: false } }),
    timelines: { 'job-busy': [running(queued, 10)] },
  });
  await openEditor(page);
  await page.getByTestId('export-button').click();
  await expect(page.locator('[data-job-id="job-busy"]')).toBeVisible();

  await page.getByLabel('終了日').fill('2022-12-31');
  await page.getByTestId('seek').fill('449');
  await expect(page.getByTestId('current-date')).toHaveText('2022.12.31');
  await expect(page.getByTestId('export-button')).toBeEnabled();
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

test('failed job shows a sanitized error and can be retried', async ({ page }) => {
  const bad = failed(makeJob({ id: 'job-failed', createdAt: '2026-11-08T02:00:00.000Z' }));
  const retried = makeJob({ id: 'job-retry', attempt: 2, createdAt: '2026-11-08T04:00:00.000Z' });
  const api = await mockApi(page, {
    list: [bad],
    onRetry: () => ({ status: 202, body: { id: 'job-retry', status: 'queued', reused: false } }),
    timelines: { 'job-retry': [retried] },
  });
  await openEditor(page);

  const item = page.locator('[data-job-id="job-failed"]');
  await expect(item.getByTestId('job-status')).toHaveText('失敗');
  await expect(item).toContainText('動画のエンコードに失敗しました。');

  await item.getByRole('button', { name: '再試行' }).click();
  expect(api.requests.some((r) => r.method === 'POST' && r.path === '/api/renders/job-failed/retry')).toBe(true);
  const newItem = page.locator('[data-job-id="job-retry"]');
  await expect(newItem.getByTestId('job-status')).toHaveText('待機中');
  // Newest first.
  await expect(page.getByTestId('job-item').first()).toHaveAttribute('data-job-id', 'job-retry');
});

test('completed job can be loaded into the editor; expired job shows 期限切れ', async ({ page }) => {
  const config = { ...DEFAULT_CONFIG, fps: 24 as const, color: '#00FF00', endDate: '2023-07-01' };
  const done = completed(makeJob({ id: 'job-done', config, configHash: 'other-hash' }));
  const old = {
    ...completed(makeJob({ id: 'job-old', createdAt: '2026-10-01T00:00:00.000Z' })),
    expired: true,
    assets: null,
  };
  await mockApi(page, { list: [done, old] });
  await openEditor(page);

  const item = page.locator('[data-job-id="job-done"]');
  await expect(item.getByTestId('job-differs')).toBeVisible();
  await item.getByRole('button', { name: 'エディターに読み込む' }).click();
  await expect(page.getByLabel('FPS', { exact: true })).toHaveValue('24');
  await expect(page.getByLabel('文字色', { exact: true })).toHaveValue('#00FF00');
  await expect(page.getByLabel('終了日')).toHaveValue('2023-07-01');

  const expired = page.locator('[data-job-id="job-old"]');
  await expect(expired.getByTestId('job-expired')).toHaveText('期限切れ');
  await expect(expired.getByTestId('job-video')).toHaveCount(0);
  await expect(expired.getByTestId('download-mov')).toHaveCount(0);
});

test('load more appends the next page', async ({ page }) => {
  const first = completed(makeJob({ id: 'job-p1', createdAt: '2026-11-08T03:00:00.000Z' }));
  const second = failed(makeJob({ id: 'job-p2', createdAt: '2026-11-01T03:00:00.000Z' }));
  await mockApi(page, {
    list: [first],
    firstPageCursor: 'cursor-2',
    pages: { 'cursor-2': { items: [second], nextCursor: null } },
  });
  await openEditor(page);

  await expect(page.getByTestId('job-item')).toHaveCount(1);
  await page.getByRole('button', { name: 'さらに読み込む' }).click();
  await expect(page.getByTestId('job-item')).toHaveCount(2);
  await expect(page.getByTestId('job-item').nth(1)).toHaveAttribute('data-job-id', 'job-p2');
  await expect(page.getByRole('button', { name: 'さらに読み込む' })).toHaveCount(0);
});
