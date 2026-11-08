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
  const date = page.getByTestId('preview-canvas');
  const seek = page.getByTestId('seek');

  await expect(date).toHaveAttribute('data-date', '2026/03/06');
  await seek.fill('299');
  await expect(date).toHaveAttribute('data-date', '2020/01/01');
  await expect(page.getByTestId('preview-canvas')).toHaveAttribute('data-frame', '299');
  await seek.fill('0');
  await expect(date).toHaveAttribute('data-date', '2026/03/06');

  await page.getByRole('button', { name: '末尾へ' }).click();
  await expect(date).toHaveAttribute('data-date', '2020/01/01');
  await page.getByRole('button', { name: '先頭へ' }).click();
  await expect(date).toHaveAttribute('data-date', '2026/03/06');
  await expect(page.getByTestId('time-counter')).toHaveText('00:00.00 / 00:10.00');
  // Only the time is shown under the preview (no date or frame count).
  await expect(page.getByTestId('time-counter').locator('xpath=..')).toHaveText('00:00.00 / 00:10.00');

  // Date changes follow the start/end inputs immediately.
  await page.getByLabel('開始日').fill('2024/02/29');
  await expect(date).toHaveAttribute('data-date', '2024/02/29');
});

test('play advances frames by time and pause holds the frame', async ({ page }) => {
  const toggle = page.getByTestId('play-toggle');
  const canvas = page.getByTestId('preview-canvas');

  await expect(toggle).toHaveAccessibleName('再生');
  await page.getByRole('button', { name: '再生' }).click();
  await expect(toggle).toHaveAccessibleName('停止');
  await expect.poll(async () => Number(await canvas.getAttribute('data-frame'))).toBeGreaterThan(10);

  await page.getByRole('button', { name: '停止' }).click();
  await expect(toggle).toHaveAccessibleName('再生');
  const held = Number(await canvas.getAttribute('data-frame'));
  await page.waitForTimeout(400);
  expect(Number(await canvas.getAttribute('data-frame'))).toBe(held);
  await expect(page.getByTestId('preview-canvas')).not.toHaveAttribute('data-date', '2026/03/06');
});

test('playback stops on the end date', async ({ page }) => {
  await page.getByLabel('長さ').fill('1');
  await page.getByTestId('play-toggle').click();
  await expect(page.getByTestId('play-toggle')).toHaveAccessibleName('再生', { timeout: 5000 });
  await expect(page.getByTestId('preview-canvas')).toHaveAttribute('data-date', '2020/01/01');
  await expect(page.getByTestId('preview-canvas')).toHaveAttribute('data-frame', '29');
});

test('canvas pixels stay transparent; the black backdrop is CSS only', async ({ page }) => {
  const canvas = page.getByTestId('preview-canvas');
  expect(await canvas.evaluate((c) => getComputedStyle(c.parentElement!).backgroundColor)).toBe('rgb(0, 0, 0)');
  expect(await canvas.evaluate((c) => getComputedStyle(c).backgroundColor)).toBe('rgba(0, 0, 0, 0)');
  await expect(page.getByRole('radio')).toHaveCount(0); // no background toggle

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
});

test('invalid settings show inline errors and disable export', async ({ page }) => {
  const exportButton = page.getByTestId('export-button');
  await expect(exportButton).toBeEnabled();

  await page.getByLabel('長さ').fill('61');
  await expect(page.locator('#err-durationSeconds')).toBeVisible();
  await expect(page.getByLabel('長さ')).toHaveAttribute('aria-invalid', 'true');
  await expect(exportButton).toBeDisabled();

  await openAdvanced(page);
  await page.getByLabel('文字色', { exact: true }).fill('nothex');
  await expect(page.locator('#err-color')).toBeVisible();

  // Collapsing 詳細設定 keeps an error note next to its summary.
  const summary = page.getByTestId('advanced-settings').locator('summary');
  await summary.click();
  await expect(page.getByLabel('文字色', { exact: true })).toBeHidden();
  await expect(summary).toContainText('エラー 1 件');

  await page.getByLabel('長さ').fill('12.5');
  await openAdvanced(page);
  await page.getByLabel('文字色', { exact: true }).fill('#00ff88');
  await expect(summary).not.toContainText('エラー');
  await expect(exportButton).toBeEnabled();
  await expect(page.locator('#err-durationSeconds')).toHaveCount(0);
});

test('only the dates and duration are shown until 詳細設定 is opened', async ({ page }) => {
  const details = page.getByTestId('advanced-settings');
  await expect(details).not.toHaveAttribute('open');
  for (const label of ['開始日', '終了日', '長さ']) {
    await expect(page.getByLabel(label, { exact: true })).toBeVisible();
  }
  for (const label of ['FPS', '解像度', '速度曲線', 'フォント', '文字色', 'フォントサイズ']) {
    await expect(page.getByLabel(label, { exact: true })).toBeHidden();
  }

  // Keyboard: focus the summary and toggle with Enter.
  await details.locator('summary').focus();
  await page.keyboard.press('Enter');
  await expect(details).toHaveAttribute('open');
  await expect(page.getByLabel('FPS', { exact: true })).toBeVisible();
});

test('page is titled 日付アニメーション', async ({ page }) => {
  await expect(page).toHaveTitle('日付アニメーション');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('日付アニメーション');
  await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', /透過MOV（ProRes 4444）/);
  // No visible subtitle under the title.
  await expect(page.getByText('開始日から終了日へ日付が切り替わる')).toHaveCount(0);
});

test('dates are shown and typed in Japanese order (YYYY/MM/DD)', async ({ page }) => {
  const start = page.getByLabel('開始日');
  await expect(start).toHaveValue('2026/03/06');
  await expect(page.getByLabel('終了日')).toHaveValue('2020/01/01');

  await start.fill('2020/02/29');
  await expect(page.getByTestId('preview-canvas')).toHaveAttribute('data-date', '2020/02/29');

  // Other separators and bare digits are normalised.
  await start.fill('');
  await start.pressSequentially('20240115');
  await expect(start).toHaveValue('2024/01/15');
  await start.fill('2023-7-4');
  await start.blur();
  await expect(start).toHaveValue('2023/07/04');
  await expect(page.getByTestId('preview-canvas')).toHaveAttribute('data-date', '2023/07/04');

  // Non-existent date → inline error, export disabled.
  await start.fill('2021/02/29');
  await expect(page.locator('#err-startDate')).toBeVisible();
  await expect(start).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByTestId('export-button')).toBeDisabled();

  // Full-width input (Japanese IME or paste) is converted.
  await start.fill('２０２０／０２／２９');
  await expect(start).toHaveValue('2020/02/29');
  await expect(page.getByTestId('preview-canvas')).toHaveAttribute('data-date', '2020/02/29');

  // While an IME is composing the text is left alone; it is normalized on compositionend.
  await start.evaluate((el) => {
    const input = el as HTMLInputElement;
    input.value = '２０２１';
    input.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: true, data: '２０２１' }));
  });
  await expect(start).toHaveValue('２０２１');
  await start.evaluate((el) => {
    const input = el as HTMLInputElement;
    input.value = '２０２１０５０５';
    input.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '２０２１０５０５' }));
  });
  await expect(start).toHaveValue('2021/05/05');
  await expect(page.getByTestId('preview-canvas')).toHaveAttribute('data-date', '2021/05/05');

  // The calendar button drives a hidden native picker; a picked date is written back.
  await expect(page.getByRole('button', { name: 'カレンダーから選ぶ' })).toHaveCount(2);
  await start.locator('xpath=..').locator('input[type="date"]').evaluate((el) => {
    const input = el as HTMLInputElement;
    input.value = '2025-12-24';
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await expect(start).toHaveValue('2025/12/24');
  await expect(page.locator('#err-startDate')).toHaveCount(0);
  await expect(page.getByTestId('export-button')).toBeEnabled();
});

test('日付の表示形式 is the first 詳細設定 option and changes the rendered date', async ({ page }) => {
  await openAdvanced(page);
  const select = page.getByLabel('日付の表示形式');
  await expect(page.getByTestId('advanced-settings').locator('select').first()).toHaveAttribute('id', 'dateFormat');
  await expect(select.locator('option')).toHaveText(['2026/03/06', '2026.03.06', '2026年03月06日']);
  await expect(page.getByLabel('速度曲線').locator('option')).toHaveText(['一定', 'なめらか', 'よりなめらか']);
  await expect(select).toHaveValue('YYYY/MM/DD');
  await expect(page.getByTestId('preview-canvas')).toHaveAttribute('data-date', '2026/03/06');

  const before = await canvasDataUrl(page);
  await select.selectOption('YYYY年MM月DD日');
  await expect(page.getByTestId('preview-canvas')).toHaveAttribute('data-date', '2026年03月06日');
  await expect.poll(() => canvasDataUrl(page)).not.toBe(before);
  await select.selectOption('YYYY.MM.DD');
  await expect(page.getByTestId('preview-canvas')).toHaveAttribute('data-date', '2026.03.06');
});

test('choosing a font loads it lazily and redraws with it', async ({ page }) => {
  await openAdvanced(page);
  const fontSelect = page.getByLabel('フォント', { exact: true });
  await expect(fontSelect.locator('option')).toHaveCount(8);
  await expect(fontSelect.locator('option', { hasText: '明朝（Noto Serif JP）' })).toHaveCount(1);
  const canvas = page.getByTestId('preview-canvas');
  await expect(canvas).toHaveAttribute('data-font', 'bundled-mono');

  const before = await canvasDataUrl(page);
  await fontSelect.selectOption('noto-serif-jp');
  await expect(canvas).toHaveAttribute('data-font', 'noto-serif-jp');
  await expect.poll(() => canvasDataUrl(page)).not.toBe(before);
  expect(await page.evaluate(() => document.fonts.check('96px "DCS Noto Serif JP"', '2026'))).toBe(true);
});

test('seek bar works by keyboard and pointer', async ({ page }) => {
  const seek = page.getByTestId('seek');
  const frame = page.getByTestId('preview-canvas');

  await seek.focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await expect(frame).toHaveAttribute('data-frame', '2');
  await page.keyboard.press('End');
  await expect(frame).toHaveAttribute('data-frame', '299');
  await expect(page.getByTestId('preview-canvas')).toHaveAttribute('data-date', '2020/01/01');
  await page.keyboard.press('Home');
  await expect(frame).toHaveAttribute('data-frame', '0');

  // Pointer: clicking the middle of the track lands near the middle frame.
  const box = (await seek.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect.poll(async () => Number(await frame.getAttribute('data-frame'))).toBeGreaterThan(120);
  await expect.poll(async () => Number(await frame.getAttribute('data-frame'))).toBeLessThan(180);
  // The filled part of the track follows the value.
  expect(await seek.evaluate((el) => (el as HTMLElement).style.getPropertyValue('--pct'))).toMatch(/^(4|5)\d\.\d+%$/);
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
    await expect(page.getByTestId('preview-canvas')).toHaveAttribute('data-date', '2020/01/01');

    await page.getByLabel('終了日').fill('20210615');
    await expect(page.getByTestId('preview-canvas')).toHaveAttribute('data-date', '2021/06/15');

    await page.getByTestId('export-button').scrollIntoViewIfNeeded();
    await expect(page.getByTestId('export-button')).toBeVisible();
    await expect(page.getByTestId('export-button')).toBeEnabled();
  });
});

test.describe('touch device', () => {
  // isMobile + hasTouch make Chromium report `(pointer: coarse)`, like a phone.
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test('tapping the calendar icon hits the real native date input', async ({ page }) => {
    // Mobile Safari ignores showPicker() on a hidden input, so touch devices get no button:
    // the transparent date input itself sits on the icon and receives the tap.
    await expect(page.getByRole('button', { name: 'カレンダーから選ぶ' })).toHaveCount(0);

    const start = page.getByLabel('開始日');
    const native = start.locator('xpath=..').locator('input[type="date"]');
    await expect(native).toHaveAttribute('aria-label', 'カレンダーから選ぶ');

    const box = await native.boundingBox();
    const field = await start.boundingBox();
    expect(box?.width).toBeGreaterThanOrEqual(32);
    expect(box?.width).toBeLessThanOrEqual(48);
    expect(box?.height).toBeGreaterThanOrEqual(32);
    // The overlay stays inside the field's right edge, so the rest of the field is still text.
    expect(box!.x).toBeGreaterThan(field!.x + field!.width - 48);
    const typeAt = (x: number, y: number) =>
      page.evaluate(
        (p) => (document.elementFromPoint(p.x, p.y) as HTMLInputElement | null)?.type,
        { x, y },
      );
    expect(await typeAt(box!.x + box!.width / 2, box!.y + box!.height / 2)).toBe('date');
    expect(await typeAt(field!.x + field!.width * 0.3, field!.y + field!.height / 2)).toBe('text');

    // Tapping the text part still focuses the text field for typing.
    await start.tap({ position: { x: 20, y: field!.height / 2 } });
    await expect(start).toBeFocused();

    await native.evaluate((el) => {
      const input = el as HTMLInputElement;
      input.value = '2025-12-24';
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await expect(start).toHaveValue('2025/12/24');
    await expect(page.getByTestId('preview-canvas')).toHaveAttribute('data-date', '2025/12/24');
  });
});
