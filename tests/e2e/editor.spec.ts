import { expect, test } from '@playwright/test';
import { canvasDataUrl, mockApi, openAdvanced, openEditor } from './fixtures.ts';

test.beforeEach(async ({ page }) => {
  await mockApi(page);
  await openEditor(page);
});

test('canvas uses the output resolution and redraws on settings change', async ({ page }) => {
  const canvas = page.getByTestId('preview-canvas');
  await expect(canvas).toHaveJSProperty('width', 1920);
  await expect(canvas).toHaveJSProperty('height', 1080);

  const before = await canvasDataUrl(page);

  await openAdvanced(page);
  await page.getByLabel('文字色', { exact: true }).fill('#FF0000');
  await expect.poll(() => canvasDataUrl(page)).not.toBe(before);

  // Drawn text pixels are now red.
  const reddest = await canvas.evaluate((c) => {
    const el = c as HTMLCanvasElement;
    const data = el.getContext('2d')!.getImageData(0, 0, el.width, el.height).data;
    let red = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] === 255 && data[i]! > 200 && data[i + 1]! < 40 && data[i + 2]! < 40) red++;
    }
    return red;
  });
  expect(reddest).toBeGreaterThan(100);

  const afterColor = await canvasDataUrl(page);
  await page.getByLabel('フォントサイズ', { exact: true }).fill('200');
  await expect.poll(() => canvasDataUrl(page)).not.toBe(afterColor);

  await page.getByLabel('解像度').selectOption('1280x720');
  await expect(canvas).toHaveJSProperty('width', 1280);
  await expect(canvas).toHaveJSProperty('height', 720);
});

test('seek 0% shows the start date and 100% shows the end date', async ({ page }) => {
  const date = page.getByTestId('current-date');
  const seek = page.getByTestId('seek');

  await expect(date).toHaveText('2026.03.06');
  await seek.fill('449');
  await expect(date).toHaveText('2020.01.01');
  await expect(page.getByTestId('frame-counter')).toHaveText('449 / 449');
  await seek.fill('0');
  await expect(date).toHaveText('2026.03.06');

  await page.getByRole('button', { name: '末尾へ' }).click();
  await expect(date).toHaveText('2020.01.01');
  await page.getByRole('button', { name: '先頭へ' }).click();
  await expect(date).toHaveText('2026.03.06');
  await expect(page.getByTestId('time-counter')).toHaveText('00:00.00 / 00:15.00');

  // Date changes follow the start/end inputs immediately.
  await page.getByLabel('開始日').fill('2024-02-29');
  await expect(date).toHaveText('2024.02.29');
});

test('play advances frames by time and pause holds the frame', async ({ page }) => {
  const toggle = page.getByTestId('play-toggle');
  const canvas = page.getByTestId('preview-canvas');

  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(async () => Number(await canvas.getAttribute('data-frame'))).toBeGreaterThan(10);

  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  const held = Number(await canvas.getAttribute('data-frame'));
  await page.waitForTimeout(400);
  expect(Number(await canvas.getAttribute('data-frame'))).toBe(held);
  await expect(page.getByTestId('current-date')).not.toHaveText('2026.03.06');
});

test('playback stops on the end date', async ({ page }) => {
  await page.getByLabel('動画秒数').fill('1');
  await page.getByTestId('play-toggle').click();
  await expect(page.getByTestId('play-toggle')).toHaveAttribute('aria-pressed', 'false', { timeout: 5000 });
  await expect(page.getByTestId('current-date')).toHaveText('2020.01.01');
  await expect(page.getByTestId('frame-counter')).toHaveText('29 / 29');
});

test('checkerboard is CSS only and never drawn into canvas pixels', async ({ page }) => {
  await openAdvanced(page);
  await expect(page.getByLabel('プレビュー背景')).toHaveValue('checkerboard');
  const canvas = page.getByTestId('preview-canvas');

  const stageBg = await canvas.evaluate((c) => getComputedStyle(c.parentElement!).backgroundImage);
  expect(stageBg).toContain('gradient');
  expect(await canvas.evaluate((c) => getComputedStyle(c).backgroundImage)).toBe('none');

  const stats = await canvas.evaluate((c) => {
    const el = c as HTMLCanvasElement;
    const ctx = el.getContext('2d')!;
    const alphaAt = (x: number, y: number) => ctx.getImageData(x, y, 1, 1).data[3];
    const data = ctx.getImageData(0, 0, el.width, el.height).data;
    let opaque = 0;
    let transparent = 0;
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] === 0) transparent++;
      else opaque++;
    }
    return {
      corners: [alphaAt(0, 0), alphaAt(el.width - 1, 0), alphaAt(0, el.height - 1), alphaAt(el.width - 1, el.height - 1)],
      opaque,
      transparent,
      total: data.length / 4,
    };
  });
  expect(stats.corners).toEqual([0, 0, 0, 0]);
  expect(stats.opaque).toBeGreaterThan(0); // the date text is drawn
  expect(stats.transparent / stats.total).toBeGreaterThan(0.9); // everything else stays transparent

  // Switching to black only changes CSS; the pixels are identical.
  const before = await canvasDataUrl(page);
  await page.getByLabel('プレビュー背景').selectOption('black');
  expect(await canvas.evaluate((c) => getComputedStyle(c.parentElement!).backgroundColor)).toBe('rgb(0, 0, 0)');
  expect(await canvasDataUrl(page)).toBe(before);
});

test('invalid settings show inline errors and disable export', async ({ page }) => {
  const exportButton = page.getByTestId('export-button');
  await expect(exportButton).toBeEnabled();

  await page.getByLabel('動画秒数').fill('61');
  await expect(page.locator('#err-durationSeconds')).toBeVisible();
  await expect(page.getByLabel('動画秒数')).toHaveAttribute('aria-invalid', 'true');
  await expect(exportButton).toBeDisabled();

  await openAdvanced(page);
  await page.getByLabel('文字色', { exact: true }).fill('nothex');
  await expect(page.locator('#err-color')).toBeVisible();

  // Collapsing 詳細設定 keeps an error note next to its summary.
  const summary = page.getByTestId('advanced-settings').locator('summary');
  await summary.click();
  await expect(page.getByLabel('文字色', { exact: true })).toBeHidden();
  await expect(summary).toContainText('エラー 1 件');

  await page.getByLabel('動画秒数').fill('12.5');
  await openAdvanced(page);
  await page.getByLabel('文字色', { exact: true }).fill('#00ff88');
  await expect(summary).not.toContainText('エラー');
  await expect(exportButton).toBeEnabled();
  await expect(page.locator('#err-durationSeconds')).toHaveCount(0);
});

test('only the dates and duration are shown until 詳細設定 is opened', async ({ page }) => {
  const details = page.getByTestId('advanced-settings');
  await expect(details).not.toHaveAttribute('open');
  for (const label of ['開始日', '終了日', '動画秒数']) {
    await expect(page.getByLabel(label, { exact: true })).toBeVisible();
  }
  for (const label of ['FPS', '解像度', '速度曲線', 'フォント', '文字色', 'フォントサイズ', '日付表示', 'プレビュー背景']) {
    await expect(page.getByLabel(label, { exact: true })).toBeHidden();
  }

  // Keyboard: focus the summary and toggle with Enter.
  await details.locator('summary').focus();
  await page.keyboard.press('Enter');
  await expect(details).toHaveAttribute('open');
  await expect(page.getByLabel('FPS', { exact: true })).toBeVisible();
});

test('date format is fixed and read-only', async ({ page }) => {
  const format = page.getByLabel('日付表示');
  await expect(format).toHaveValue('YYYY.MM.DD');
  await expect(format).toHaveAttribute('readonly', '');
});

test.describe('mobile 375×812', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test('main controls are visible and usable without horizontal scroll', async ({ page }) => {
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth).toBeLessThanOrEqual(375);

    const canvas = page.getByTestId('preview-canvas');
    await expect(canvas).toBeVisible();
    const box = await canvas.boundingBox();
    expect(box?.width).toBeLessThanOrEqual(375);

    await expect(page.getByTestId('play-toggle')).toBeVisible();
    await page.getByRole('button', { name: '末尾へ' }).click();
    await expect(page.getByTestId('current-date')).toHaveText('2020.01.01');

    await page.getByLabel('終了日').fill('2021-06-15');
    await expect(page.getByTestId('current-date')).toHaveText('2021.06.15');

    await page.getByTestId('export-button').scrollIntoViewIfNeeded();
    await expect(page.getByTestId('export-button')).toBeVisible();
    await expect(page.getByTestId('export-button')).toBeEnabled();
  });
});
