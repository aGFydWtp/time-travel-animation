// Mock render API for UI tests (contract: src/lib/api/types.ts). No backend needed.
import type { Page, Route } from '@playwright/test';
import type { ListRendersResponse, RenderAssetInfo, RenderJob } from '../../src/lib/api/types.ts';
import { hashConfig } from '../../src/lib/renderer/schema.ts';
import { DEFAULT_CONFIG, type RenderConfig } from '../../src/lib/renderer/types.ts';

export const DEFAULT_HASH = await hashConfig(DEFAULT_CONFIG);

function asset(jobId: string, format: 'mp4' | 'mov'): RenderAssetInfo {
  return {
    format,
    contentType: format === 'mp4' ? 'video/mp4' : 'video/quicktime',
    bytes: format === 'mp4' ? 2_400_000 : 380_000_000,
    url: `/api/renders/${jobId}/assets/${format}`,
    downloadUrl: `/api/renders/${jobId}/assets/${format}?download=1`,
  };
}

export function makeJob(overrides: Partial<RenderJob> & { id: string }): RenderJob {
  const config: RenderConfig = overrides.config ?? { ...DEFAULT_CONFIG };
  return {
    status: 'queued',
    stage: 'queued',
    progress: 0,
    attempt: 1,
    config,
    configHash: DEFAULT_HASH,
    createdAt: '2026-11-08T03:00:00.000Z',
    updatedAt: '2026-11-08T03:00:00.000Z',
    startedAt: null,
    completedAt: null,
    expiresAt: null,
    expired: false,
    error: null,
    assets: null,
    ...overrides,
  };
}

export function running(job: RenderJob, progress: number): RenderJob {
  return {
    ...job,
    status: 'running',
    stage: 'rendering_frames',
    progress,
    startedAt: '2026-11-08T03:00:05.000Z',
    updatedAt: `2026-11-08T03:00:${String(10 + Math.round(progress / 10)).padStart(2, '0')}.000Z`,
  };
}

export function completed(job: RenderJob): RenderJob {
  return {
    ...job,
    status: 'completed',
    stage: 'done',
    progress: 100,
    completedAt: '2026-11-08T03:01:00.000Z',
    updatedAt: '2026-11-08T03:01:00.000Z',
    expiresAt: '2026-12-08T03:01:00.000Z',
    assets: { mp4: asset(job.id, 'mp4'), mov: asset(job.id, 'mov') },
  };
}

export function failed(job: RenderJob): RenderJob {
  return {
    ...job,
    status: 'failed',
    stage: 'encoding',
    progress: 62,
    updatedAt: '2026-11-08T03:00:40.000Z',
    error: { code: 'render_failed', message: '動画のエンコードに失敗しました。' },
  };
}

export interface MockApi {
  /** Jobs returned by GET /api/renders (first page). */
  list: RenderJob[];
  /** Extra pages keyed by cursor. */
  pages: Record<string, ListRendersResponse>;
  firstPageCursor: string | null;
  /** Successive GET /api/renders/:id responses per job (last one repeats). */
  timelines: Record<string, RenderJob[]>;
  /** Handler for POST /api/renders. */
  onCreate: (body: unknown) => { status: number; body: unknown; headers?: Record<string, string> };
  /** Optional override for GET /api/renders/:id (e.g. 401/404); return null to fall through. */
  onGet: (id: string) => { status: number; body: unknown } | null;
  /** Handler for POST /api/renders/:id/retry. */
  onRetry: (id: string) => { status: number; body: unknown };
  requests: { method: string; path: string; body: unknown }[];
}

const json = (route: Route, status: number, body: unknown, headers: Record<string, string> = {}) =>
  route.fulfill({ status, contentType: 'application/json', headers, body: JSON.stringify(body) });

export async function mockApi(page: Page, init: Partial<MockApi> = {}): Promise<MockApi> {
  const state: MockApi = {
    list: [],
    pages: {},
    firstPageCursor: null,
    timelines: {},
    onCreate: () => ({ status: 500, body: { error: { code: 'internal', message: 'not mocked' } } }),
    onRetry: () => ({ status: 500, body: { error: { code: 'internal', message: 'not mocked' } } }),
    onGet: () => null,
    requests: [],
    ...init,
  };

  await page.route('**/api/renders**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    const body = request.postData() ? JSON.parse(request.postData() ?? 'null') : null;
    state.requests.push({ method, path: url.pathname + url.search, body });

    const parts = url.pathname.replace(/^\/api\/renders\/?/, '').split('/').filter(Boolean);

    if (method === 'GET' && parts.length === 0) {
      const cursor = url.searchParams.get('cursor');
      if (cursor) return json(route, 200, state.pages[cursor] ?? { items: [], nextCursor: null });
      return json(route, 200, { items: state.list, nextCursor: state.firstPageCursor } satisfies ListRendersResponse);
    }
    if (method === 'POST' && parts.length === 0) {
      const res = state.onCreate(body);
      return json(route, res.status, res.body, res.headers);
    }
    if (method === 'GET' && parts.length === 1) {
      const id = decodeURIComponent(parts[0] ?? '');
      const override = state.onGet(id);
      if (override) return json(route, override.status, override.body);
      const timeline = state.timelines[id];
      const fromList = state.list.find((j) => j.id === id);
      if (timeline && timeline.length > 0) {
        const next = timeline.length > 1 ? timeline.shift() : timeline[0];
        return json(route, 200, next);
      }
      if (fromList) return json(route, 200, fromList);
      return json(route, 404, { error: { code: 'not_found', message: 'not found' } });
    }
    if (method === 'POST' && parts.length === 2 && parts[1] === 'retry') {
      const res = state.onRetry(decodeURIComponent(parts[0] ?? ''));
      return json(route, res.status, res.body);
    }
    // Asset URLs etc.: not part of these UI tests.
    return route.fulfill({ status: 204 });
  });

  return state;
}

/** Navigate and wait until the bundled font has loaded and the first frame is drawn. */
export async function openEditor(page: Page): Promise<void> {
  await page.goto('/');
  await page.locator('[data-testid="preview-canvas"][data-ready="true"]').waitFor();
}

/** Open /history and wait for the first list response to render. */
export async function openHistory(page: Page): Promise<void> {
  await page.goto('/history');
  await page.getByRole('heading', { level: 1, name: '書き出し履歴' }).waitFor();
  await page.locator('section[aria-busy="false"]').waitFor();
}

/** Expand the collapsed 詳細設定 section (no-op when already open). */
export async function openAdvanced(page: Page): Promise<void> {
  const details = page.getByTestId('advanced-settings');
  if (!(await details.evaluate((d) => (d as HTMLDetailsElement).open))) await details.locator('summary').click();
}

/** PNG data URL of the preview canvas. */
export function canvasDataUrl(page: Page): Promise<string> {
  return page.getByTestId('preview-canvas').evaluate((c) => (c as HTMLCanvasElement).toDataURL());
}
