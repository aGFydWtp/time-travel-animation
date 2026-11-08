// /history: the job list, its row states, polling and navigation back to the editor.
import { expect, test } from '@playwright/test';
import { DEFAULT_CONFIG } from '../../src/lib/renderer/types.ts';
import { completed, failed, makeJob, mockApi, openEditor, openHistory, running } from './fixtures.ts';

test('header links switch between the editor and history', async ({ page }) => {
  await mockApi(page);
  await openEditor(page);
  await page.getByRole('link', { name: '書き出し一覧' }).click();
  await expect(page).toHaveURL(/\/history$/);
  await expect(page.getByRole('heading', { level: 1, name: '書き出し一覧' })).toBeVisible();
  await expect(page.getByText('まだ書き出していません')).toBeVisible();
  await expect(page).toHaveTitle('書き出し一覧 · 日付アニメーション');

  await page.getByRole('link', { name: '日付アニメーション' }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByTestId('preview-canvas')).toBeVisible();
});

test('今の設定 marks only jobs made with the editor’s current settings', async ({ page }) => {
  const same = completed(makeJob({ id: 'job-same', createdAt: '2026-11-08T05:00:00.000Z' }));
  const other = completed(makeJob({ id: 'job-other', configHash: 'other-hash' }));
  await mockApi(page, { list: [same, other] });
  await openEditor(page); // saves the editor config for /history
  await openHistory(page);
  await expect(page.locator('[data-job-id="job-same"]').getByTestId('job-current')).toHaveText('今の設定');
  await expect(page.locator('[data-job-id="job-other"]').getByTestId('job-current')).toHaveCount(0);
});

test('without a saved editor config no marker is shown', async ({ page }) => {
  await mockApi(page, { list: [completed(makeJob({ id: 'job-same' }))] });
  await openHistory(page);
  await expect(page.getByTestId('job-current')).toHaveCount(0);
});

test('failed job shows a sanitized error and can be retried', async ({ page }) => {
  const bad = failed(makeJob({ id: 'job-failed', createdAt: '2026-11-08T02:00:00.000Z' }));
  const retried = makeJob({ id: 'job-retry', attempt: 2, createdAt: '2026-11-08T04:00:00.000Z' });
  const api = await mockApi(page, {
    list: [bad],
    onRetry: () => ({ status: 202, body: { id: 'job-retry', status: 'queued', reused: false } }),
    timelines: { 'job-retry': [retried] },
  });
  await openHistory(page);

  const item = page.locator('[data-job-id="job-failed"]');
  await expect(item.getByTestId('job-status')).toHaveText('失敗');
  await expect(item).toContainText('失敗：動画のエンコードに失敗しました。');

  await item.getByRole('button', { name: 'もう一度書き出す' }).click();
  expect(api.requests.some((r) => r.method === 'POST' && r.path === '/api/renders/job-failed/retry')).toBe(true);
  const newItem = page.locator('[data-job-id="job-retry"]');
  await expect(newItem.getByTestId('job-status')).toHaveText('待機中');
  // Newest first.
  await expect(page.getByTestId('job-item').first()).toHaveAttribute('data-job-id', 'job-retry');
});

test('completed rows: labelled downloads; 再生して確認 opens the video, settings and editor link', async ({ page }) => {
  const newer = completed(makeJob({ id: 'job-a', createdAt: '2026-11-08T05:00:00.000Z' }));
  const older = completed(makeJob({ id: 'job-b', createdAt: '2026-11-08T04:00:00.000Z' }));
  await mockApi(page, { list: [newer, older] });
  await openHistory(page);

  const a = page.locator('[data-job-id="job-a"]');
  const b = page.locator('[data-job-id="job-b"]');
  // Everything starts closed; completed rows show no status word, just downloads.
  await expect(page.getByTestId('job-video')).toHaveCount(0);
  await expect(a.getByTestId('job-status')).toHaveCount(0);
  await expect(a.getByTestId('download-mov')).toHaveText('透過MOVをダウンロード 362 MB');
  await expect(a.getByTestId('download-mp4')).toHaveText('確認用MP4をダウンロード 2.3 MB');

  const toggle = b.getByTestId('job-details-toggle');
  await expect(toggle).toHaveAccessibleName('再生して確認');
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(toggle).toHaveAccessibleName('閉じる');
  await expect(b.getByTestId('job-video')).toHaveAttribute('src', '/api/renders/job-b/assets/mp4');
  await expect(b.getByTestId('job-details')).toContainText('1920×1080 · 30fps');
  await expect(b.getByRole('link', { name: 'この設定をエディターで開く' })).toHaveAttribute('href', '/?from=job-b');
  await expect(a.getByTestId('job-video')).toHaveCount(0);

  await toggle.click();
  await expect(page.getByTestId('job-video')).toHaveCount(0);
});

test('この設定をエディターで開く opens the editor with that job’s settings', async ({ page }) => {
  const config = { ...DEFAULT_CONFIG, fps: 24 as const, color: '#00FF00', endDate: '2023-07-01' };
  await mockApi(page, { list: [completed(makeJob({ id: 'job-done', config, configHash: 'other-hash' }))] });
  await openHistory(page);
  const item = page.locator('[data-job-id="job-done"]');
  await item.getByRole('button', { name: '再生して確認' }).click();
  await item.getByRole('link', { name: 'この設定をエディターで開く' }).click();
  await expect(page).toHaveURL(/\/\?from=job-done$/);
  await expect(page.getByLabel('FPS', { exact: true })).toHaveValue('24');
  await expect(page.getByLabel('終了日')).toHaveValue('2023/07/01');
});

test('expired job shows 期限切れ and no downloads', async ({ page }) => {
  const old = {
    ...completed(makeJob({ id: 'job-old', createdAt: '2026-10-01T00:00:00.000Z' })),
    expired: true,
    assets: null,
  };
  await mockApi(page, { list: [old] });
  await openHistory(page);
  const expired = page.locator('[data-job-id="job-old"]');
  await expect(expired.getByTestId('job-expired')).toHaveText('期限切れ');
  await expect(expired.getByTestId('download-mov')).toHaveCount(0);
  await expired.getByRole('button', { name: '設定を見る' }).click();
  await expect(expired.getByTestId('job-video')).toHaveCount(0);
  await expect(expired.getByTestId('job-details')).toContainText('保存期間が過ぎた');
});

test('running job shows one compact progress indicator and finishes', async ({ page }) => {
  const job = running(makeJob({ id: 'job-run' }), 43);
  await mockApi(page, { list: [job], timelines: { 'job-run': [job, completed(job)] } });
  await openHistory(page);
  const item = page.locator('[data-job-id="job-run"]');
  await expect(item.locator('progress')).toHaveCount(1);
  await expect(item.locator('progress')).toHaveAttribute('value', '43');
  await expect(item.getByTestId('job-stage')).toHaveText('フレーム描画中');
  await expect(item).toContainText('43%');
  const width = await item.locator('progress').evaluate((el) => el.getBoundingClientRect().width);
  expect(width).toBeLessThanOrEqual(100);
});

test('load more appends the next page', async ({ page }) => {
  const first = completed(makeJob({ id: 'job-p1', createdAt: '2026-11-08T03:00:00.000Z' }));
  const second = failed(makeJob({ id: 'job-p2', createdAt: '2026-11-01T03:00:00.000Z' }));
  await mockApi(page, {
    list: [first],
    firstPageCursor: 'cursor-2',
    pages: { 'cursor-2': { items: [second], nextCursor: null } },
  });
  await openHistory(page);

  await expect(page.getByTestId('job-item')).toHaveCount(1);
  await page.getByRole('button', { name: 'さらに読み込む' }).click();
  await expect(page.getByTestId('job-item')).toHaveCount(2);
  await expect(page.getByTestId('job-item').nth(1)).toHaveAttribute('data-job-id', 'job-p2');
  await expect(page.getByRole('button', { name: 'さらに読み込む' })).toHaveCount(0);
});

test('401 while polling stops polling and asks the user to sign in again', async ({ page }) => {
  const job = running(makeJob({ id: 'job-auth' }), 30);
  const api = await mockApi(page, {
    list: [job],
    onGet: () => ({ status: 401, body: { error: { code: 'unauthorized', message: 'no session' } } }),
  });
  await openHistory(page);

  await expect(page.getByRole('alert')).toContainText('ページを再読み込み', { timeout: 10_000 });
  const polls = () => api.requests.filter((r) => r.method === 'GET' && r.path === '/api/renders/job-auth').length;
  const count = polls();
  await page.waitForTimeout(4_000);
  expect(polls()).toBe(count);
});

test('404 while polling marks the job unavailable and stops polling it', async ({ page }) => {
  const job = running(makeJob({ id: 'job-gone' }), 30);
  const api = await mockApi(page, {
    list: [job],
    onGet: () => ({ status: 404, body: { error: { code: 'not_found', message: 'gone' } } }),
  });
  await openHistory(page);

  const item = page.locator('[data-job-id="job-gone"]');
  await expect(item.getByTestId('job-unavailable')).toBeVisible({ timeout: 10_000 });
  await expect(item.locator('progress')).toHaveCount(0);
  const polls = () => api.requests.filter((r) => r.method === 'GET' && r.path === '/api/renders/job-gone').length;
  const count = polls();
  await page.waitForTimeout(4_000);
  expect(polls()).toBe(count);
});

test.describe('mobile 375×812', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test('history has no horizontal scroll and keeps the running indicator on one line', async ({ page }) => {
    const run = running(makeJob({ id: 'job-run', createdAt: '2026-11-08T06:00:00.000Z' }), 43);
    await mockApi(page, { list: [run, completed(makeJob({ id: 'job-ok' })), failed(makeJob({ id: 'job-bad' }))] });
    await openHistory(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
    const group = page.locator('[data-job-id="job-run"] .progress-group');
    const box = (await group.boundingBox())!;
    expect(box.height).toBeLessThan(30);

    // Proximity: a job's actions sit right under its title; the next job starts clearly further down.
    const ok = page.locator('[data-job-id="job-ok"]');
    const title = (await ok.locator('.title').boundingBox())!;
    const action = (await ok.getByTestId('download-mov').boundingBox())!;
    expect(Math.abs(action.x - title.x)).toBeLessThan(2); // left-aligned in one column
    const okBox = (await ok.boundingBox())!;
    const next = (await page.locator('[data-job-id="job-bad"]').boundingBox())!;
    expect(next.y - (okBox.y + okBox.height)).toBeGreaterThanOrEqual(8); // separate cards
    const card = await ok.evaluate((el) => {
      const cs = getComputedStyle(el);
      return { bg: cs.backgroundColor, border: cs.borderTopWidth, shadow: cs.boxShadow };
    });
    expect(card).toEqual({ bg: 'rgb(245, 245, 245)', border: '0px', shadow: 'none' });
  });
});
