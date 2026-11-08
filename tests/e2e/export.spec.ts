// Export from the editor (/): inline status line for the job just started.
import { expect, test } from '@playwright/test';
import { DEFAULT_CONFIG } from '../../src/lib/renderer/types.ts';
import { completed, failed, makeJob, mockApi, openEditor, running } from './fixtures.ts';

test('the 書き出す button carries the export state: queued → running → completed → re-export', async ({ page }) => {
  const queued = makeJob({ id: 'job-new' });
  let creates = 0;
  const api = await mockApi(page, {
    onCreate: () => ({ status: 202, body: { id: ++creates === 1 ? 'job-new' : 'job-again', status: 'queued', reused: false } }),
    timelines: {
      'job-new': [queued, queued, running(queued, 40), running(queued, 80), completed(queued)],
      'job-again': [running(makeJob({ id: 'job-again' }), 10)],
    },
  });
  await openEditor(page);
  const button = page.getByTestId('export-button');
  await expect(button).toHaveText('書き出す');
  await expect(page.getByTestId('export-summary')).toHaveText('1920×1080 · 30fps · 10秒');

  await button.click();
  // The pill keeps focus while it is busy (aria-disabled, not disabled).
  await expect(button).toBeFocused();
  await expect(button).toHaveAttribute('aria-disabled', 'true');
  const post = api.requests.find((r) => r.method === 'POST');
  expect((post?.body as { config: unknown }).config).toEqual(DEFAULT_CONFIG);
  expect((post?.body as { idempotencyKey?: string }).idempotencyKey).toBeTruthy();

  // Busy: disabled, progress inside the pill, exposed as a progressbar.
  await expect(button).toBeDisabled();
  await expect(button).toContainText('待機中…');
  await expect(button).toContainText(/書き出し中… (40|80)%/, { timeout: 15_000 });
  await expect(page.getByTestId('export-progress')).toHaveAttribute('aria-valuenow', /^(40|80)$/);
  await expect(page.getByTestId('export-summary')).toContainText('現在の設定');
  await expect(page.getByTestId('export-notice')).toHaveCount(0);

  // Done: the button is back, with a result group holding the downloads.
  await expect(button).toHaveText('書き出す', { timeout: 20_000 });
  await expect(button).toBeEnabled();
  await expect(page.getByTestId('export-progress')).toHaveCount(0);
  const result = page.getByTestId('export-result');
  await expect(result).toContainText('書き出しが完了しました');
  await expect(result.getByTestId('download-mov')).toHaveText('透過MOVをダウンロード 362 MB');
  await expect(result.getByTestId('download-mov')).toHaveAttribute('href', '/api/renders/job-new/assets/mov?download=1');
  await expect(result.getByTestId('download-mp4')).toHaveText('確認用MP4をダウンロード 2.3 MB');
  await expect(result.getByTestId('download-mp4')).toHaveAttribute('href', '/api/renders/job-new/assets/mp4?download=1');

  // Changing settings keeps the result but marks it as the previous export.
  await page.getByLabel('長さ').fill('12');
  await expect(result).toContainText('前回の書き出し');

  // Pressing 書き出す again starts a new export.
  await button.click();
  await expect.poll(() => api.requests.filter((r) => r.method === 'POST').length).toBe(2);
  await expect(button).toContainText('書き出し中… 10%');
  await expect(page.getByTestId('export-result')).toHaveCount(0);
});

test('editing stays possible while an export is running', async ({ page }) => {
  const queued = makeJob({ id: 'job-busy' });
  await mockApi(page, {
    onCreate: () => ({ status: 202, body: { id: 'job-busy', status: 'queued', reused: false } }),
    timelines: { 'job-busy': [running(queued, 10)] },
  });
  await openEditor(page);
  await page.getByTestId('export-button').click();
  await expect(page.getByTestId('export-button')).toContainText('書き出し中… 10%');

  await page.getByLabel('終了日').fill('2022/12/31');
  await page.getByTestId('seek').fill('299');
  await expect(page.getByTestId('preview-canvas')).toHaveAttribute('data-date', '2022/12/31');
  await expect(page.getByTestId('export-summary')).toContainText('（書き出し中の設定とは異なります）');
  await expect(page.getByTestId('export-button')).toBeDisabled();
});

test('a failed export says why; pressing 書き出す again is the retry', async ({ page }) => {
  const bad = failed(makeJob({ id: 'job-bad' }));
  let creates = 0;
  const api = await mockApi(page, {
    onCreate: () => ({ status: 202, body: { id: ++creates === 1 ? 'job-bad' : 'job-ok', status: 'queued', reused: false } }),
    timelines: { 'job-bad': [bad], 'job-ok': [completed(makeJob({ id: 'job-ok' }))] },
  });
  await openEditor(page);
  await page.getByTestId('export-button').click();

  const result = page.getByTestId('export-result');
  await expect(result).toHaveText('書き出しに失敗しました：動画のエンコードに失敗しました。');
  await expect(page.getByRole('button', { name: /再試行|もう一度/ })).toHaveCount(0);
  await expect(page.getByTestId('export-button')).toBeEnabled();

  await page.getByTestId('export-button').click();
  await expect(result).toContainText('書き出しが完了しました');
  expect(api.requests.filter((r) => r.method === 'POST' && r.path === '/api/renders')).toHaveLength(2);
});

test('a reused job is noted once', async ({ page }) => {
  await mockApi(page, {
    onCreate: () => ({ status: 200, body: { id: 'job-same', status: 'running', reused: true } }),
    timelines: { 'job-same': [running(makeJob({ id: 'job-same' }), 20)] },
  });
  await openEditor(page);
  await page.getByTestId('export-button').click();
  await expect(page.getByTestId('export-notice')).toHaveText('同じ設定の書き出しが進行中です');
  await expect(page.getByTestId('export-button')).toContainText('書き出し中… 20%');
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
  await expect(page.getByTestId('export-result')).toContainText('書き出しが完了しました');
  expect(keys()).toHaveLength(2);
  expect(keys()[1]).toBe(keys()[0]);

  // A different config gets a new key.
  await page.getByLabel('長さ').fill('12');
  await page.getByTestId('export-button').click();
  await expect.poll(() => keys().length).toBe(3);
  expect(keys()[2]).not.toBe(keys()[0]);
});

test('/?from=<id> loads that job into the editor; a missing job is reported', async ({ page }) => {
  const config = { ...DEFAULT_CONFIG, fps: 24 as const, color: '#00FF00', endDate: '2023-07-01' };
  await mockApi(page, { list: [completed(makeJob({ id: 'job-done', config }))] });

  await page.goto('/?from=job-done');
  await expect(page.getByTestId('export-notice')).toHaveText('設定を読み込みました');
  await expect(page).toHaveURL(/\/$/); // applied once, then removed from the URL
  await expect(page.getByLabel('FPS', { exact: true })).toHaveValue('24');
  await expect(page.getByLabel('文字色', { exact: true })).toHaveValue('#00FF00');
  await expect(page.getByLabel('終了日')).toHaveValue('2023/07/01');

  await page.goto('/?from=job-missing');
  await expect(page.getByTestId('export-notice')).toHaveText('指定された書き出しが見つかりませんでした');
  await expect(page.getByLabel('終了日')).toHaveValue('2020/01/01');
});

test('after a 401 stops tracking, a later successful export is tracked again', async ({ page }) => {
  const first = makeJob({ id: 'job-1' });
  let firstGets = 0;
  let creates = 0;
  await mockApi(page, {
    onCreate: () => ({ status: 202, body: { id: ++creates === 1 ? 'job-1' : 'job-2', status: 'queued', reused: false } }),
    onGet: (id) =>
      id === 'job-1' && ++firstGets > 1
        ? { status: 401, body: { error: { code: 'unauthorized', message: 'no session' } } }
        : null,
    timelines: { 'job-1': [running(first, 5)], 'job-2': [running(makeJob({ id: 'job-2' }), 30)] },
  });
  await openEditor(page);
  const button = page.getByTestId('export-button');
  await button.click();
  await expect(button).toContainText('書き出し中… 5%');
  await expect(page.getByRole('alert')).toContainText('ページを再読み込み', { timeout: 10_000 });
  await expect(button).toHaveText('書き出す');

  await button.click();
  await expect(button).toContainText('書き出し中… 30%');
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('a reload during an export resumes tracking it', async ({ page }) => {
  const job = running(makeJob({ id: 'job-live' }), 25);
  await mockApi(page, {
    onCreate: () => ({ status: 202, body: { id: 'job-live', status: 'queued', reused: false } }),
    timelines: { 'job-live': [job] },
  });
  await openEditor(page);
  await page.getByTestId('export-button').click();
  await expect(page.getByTestId('export-button')).toContainText('書き出し中… 25%');

  await page.reload();
  await page.locator('[data-testid="preview-canvas"][data-ready="true"]').waitFor();
  await expect(page.getByTestId('export-button')).toContainText('書き出し中… 25%');
});

test('repeated polling failures show a connection note that clears on recovery', async ({ page }) => {
  await page.clock.install();
  const job = running(makeJob({ id: 'job-flaky' }), 50);
  let failing = false;
  const api = await mockApi(page, {
    onCreate: () => ({ status: 202, body: { id: 'job-flaky', status: 'queued', reused: false } }),
    onGet: () => (failing ? { status: 503, body: { error: { code: 'internal', message: 'down' } } } : null),
    timelines: { 'job-flaky': [job] },
  });
  await openEditor(page);
  await page.getByTestId('export-button').click();
  await expect(page.getByTestId('export-button')).toContainText('書き出し中… 50%');

  // Advance fake time one poll at a time, letting each (real) mocked response arrive.
  const polls = () => api.requests.filter((r) => r.method === 'GET' && r.path === '/api/renders/job-flaky').length;
  const nextPoll = async () => {
    const before = polls();
    await page.clock.runFor(10_000); // ≥ the max backoff, so exactly one poll fires
    await expect.poll(polls).toBeGreaterThan(before);
  };

  failing = true;
  for (let i = 0; i < 4; i++) await nextPoll();
  await expect(page.getByTestId('connection-lost')).toHaveCount(0); // 4 failures: not yet
  await nextPoll();
  await expect(page.getByTestId('connection-lost')).toHaveText('状態を取得できません。通信状況を確認してください');
  await expect(page.getByTestId('export-button')).toContainText('書き出し中');

  failing = false;
  await nextPoll();
  await expect(page.getByTestId('connection-lost')).toHaveCount(0);
});
