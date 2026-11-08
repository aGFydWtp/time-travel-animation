<script lang="ts">
  import { onMount } from 'svelte';
  import type { Props } from './index.server.ts';
  import { api, describeApiError } from '../src/lib/api/client.ts';
  import type { RenderJob } from '../src/lib/api/types.ts';
  import JobList from '../src/lib/components/JobList.svelte';
  import PreviewPane from '../src/lib/components/PreviewPane.svelte';
  import SettingsPanel from '../src/lib/components/SettingsPanel.svelte';
  import { hashConfig, safeParseRenderConfig } from '../src/lib/renderer/schema.ts';
  import { DEFAULT_CONFIG, type RenderConfig } from '../src/lib/renderer/types.ts';
  import {
    defaultForm,
    fieldErrors,
    formFromConfig,
    formToConfigInput,
    type PreviewBackground,
  } from '../src/lib/ui/editor-form.ts';
  import { IdempotencyKeys, isTerminalCreateError } from '../src/lib/ui/idempotency.ts';
  import {
    POLL_MIN_MS,
    classifyPollFailure,
    isActiveJob,
    jobChanged,
    mergeJobs,
    nextPollDelay,
  } from '../src/lib/ui/poll.ts';

  let { title }: Props = $props();

  // ---- editor ----------------------------------------------------------
  let form = $state(defaultForm());
  let background: PreviewBackground = $state('checkerboard');

  const parsed = $derived(safeParseRenderConfig(formToConfigInput(form)));
  const errors = $derived(parsed.success ? {} : fieldErrors(parsed.error.issues));
  const errorCount = $derived(Object.keys(errors).length);

  // The preview keeps showing the last valid config while a field is mid-edit.
  let lastValid: RenderConfig = { ...DEFAULT_CONFIG };
  const previewConfig = $derived.by(() => {
    if (parsed.success) lastValid = parsed.data;
    return lastValid;
  });

  let currentHash: string | null = $state(null);
  let hashToken = 0;
  $effect(() => {
    const config = previewConfig;
    const token = ++hashToken;
    hashConfig(config).then(
      (hash) => {
        if (token === hashToken) currentHash = hash;
      },
      () => {
        if (token === hashToken) currentHash = null;
      },
    );
  });

  // ---- export ----------------------------------------------------------
  let exporting = $state(false);
  let notice: { kind: 'ok' | 'error'; text: string } | null = $state(null);
  const idempotencyKeys = new IdempotencyKeys();

  async function startExport() {
    if (!parsed.success || exporting) return;
    const config = parsed.data;
    exporting = true;
    notice = null;
    try {
      // Same config resubmitted after a lost response → same key, so the server dedupes it.
      const key = idempotencyKeys.keyFor(await hashConfig(config));
      let res;
      try {
        res = await api.createRender(config, key);
        idempotencyKeys.settle();
      } catch (error) {
        if (isTerminalCreateError(error)) idempotencyKeys.settle();
        throw error;
      }
      notice = {
        kind: 'ok',
        text: res.reused
          ? '同じ設定の書き出しが進行中です。そのジョブの進捗を表示します。'
          : '書き出しを開始しました。進捗は書き出し履歴に表示されます。',
      };
      await fetchJob(res.id);
    } catch (error) {
      notice = { kind: 'error', text: describeApiError(error) };
    } finally {
      exporting = false;
    }
  }

  function loadIntoEditor(job: RenderJob) {
    form = formFromConfig(job.config);
    notice = { kind: 'ok', text: 'ジョブの設定をエディターに読み込みました。' };
    document.getElementById('settings-title')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // ---- job list & polling ---------------------------------------------
  let jobs: RenderJob[] = $state([]);
  let nextCursor: string | null = $state(null);
  let listLoading = $state(true);
  let loadingMore = $state(false);
  let listError: string | null = $state(null);
  let retryingIds: ReadonlySet<string> = $state(new Set());
  /** Jobs that returned 404 while polling; they are no longer polled. */
  let unavailableIds: ReadonlySet<string> = $state(new Set());
  /** Set when polling got 401/403; polling stays stopped until a list refresh succeeds. */
  let authLost = $state(false);
  const AUTH_LOST_MESSAGE = 'ログインの有効期限が切れた可能性があります。ページを再読み込みして、もう一度サインインしてください。';

  let pollDelay = POLL_MIN_MS;
  let pollTimer: ReturnType<typeof setTimeout> | undefined;
  let polling = false;
  let disposed = false;

  async function refreshList() {
    listLoading = true;
    try {
      const page = await api.listRenders();
      jobs = mergeJobs(jobs, page.items);
      // Keep a deeper cursor if the user already paged further.
      if (nextCursor === null || jobs.length <= page.items.length) nextCursor = page.nextCursor;
      listError = null;
      authLost = false;
    } catch (error) {
      listError = `書き出し履歴を取得できませんでした。${describeApiError(error)}`;
    } finally {
      listLoading = false;
    }
    kickPoll();
  }

  async function loadMore() {
    if (!nextCursor || loadingMore) return;
    loadingMore = true;
    try {
      const page = await api.listRenders({ cursor: nextCursor });
      jobs = mergeJobs(jobs, page.items);
      nextCursor = page.nextCursor;
      listError = null;
    } catch (error) {
      if (!authLost) listError = `続きを取得できませんでした。${describeApiError(error)}`;
    } finally {
      loadingMore = false;
    }
    kickPoll();
  }

  async function fetchJob(id: string) {
    try {
      const job = await api.getRender(id);
      jobs = mergeJobs(jobs, [job]);
    } catch {
      await refreshList();
      return;
    }
    kickPoll();
  }

  async function retry(job: RenderJob) {
    retryingIds = new Set([...retryingIds, job.id]);
    try {
      const res = await api.retryRender(job.id);
      notice = { kind: 'ok', text: '再試行を開始しました。' };
      await fetchJob(res.id);
    } catch (error) {
      notice = { kind: 'error', text: describeApiError(error) };
    } finally {
      const next = new Set(retryingIds);
      next.delete(job.id);
      retryingIds = next;
    }
  }

  /** Restart polling at the base interval (new/changed active jobs). */
  function kickPoll() {
    pollDelay = POLL_MIN_MS;
    schedulePoll();
  }

  /** Active jobs that can still be polled (not 404'd). */
  function pollableJobs(): RenderJob[] {
    return jobs.filter((job) => isActiveJob(job) && !unavailableIds.has(job.id));
  }

  function schedulePoll() {
    clearTimeout(pollTimer);
    if (disposed || polling || authLost || pollableJobs().length === 0) return;
    pollTimer = setTimeout(pollOnce, pollDelay);
  }

  async function pollOnce() {
    polling = true;
    let changed = false;
    let finished = false;
    try {
      const active = pollableJobs();
      const results = await Promise.allSettled(active.map((j) => api.getRender(j.id)));
      const fresh: RenderJob[] = [];
      const gone: string[] = [];
      results.forEach((result, i) => {
        const before = active[i];
        if (result.status === 'rejected') {
          const failure = classifyPollFailure(result.reason);
          if (failure === 'auth') authLost = true;
          else if (failure === 'gone' && before) gone.push(before.id);
          return;
        }
        if (jobChanged(before, result.value)) changed = true;
        if (!isActiveJob(result.value)) finished = true;
        fresh.push(result.value);
      });
      if (fresh.length > 0) jobs = mergeJobs(jobs, fresh);
      if (gone.length > 0) {
        unavailableIds = new Set([...unavailableIds, ...gone]);
        changed = true;
      }
    } finally {
      polling = false;
    }
    if (authLost) {
      clearTimeout(pollTimer);
      listError = AUTH_LOST_MESSAGE;
      return;
    }
    pollDelay = nextPollDelay(pollDelay, changed);
    if (finished) {
      // A job settled: refresh the list so retries/new jobs from elsewhere show up too.
      await refreshList();
      return;
    }
    schedulePoll();
  }

  onMount(() => {
    refreshList();
    return () => {
      disposed = true;
      clearTimeout(pollTimer);
    };
  });
</script>

<div class="app">
  <header class="header">
    <h1>{title}</h1>
    <p class="lead">日付が流れるカウントダウン動画を作成し、透過 MOV と確認用 MP4 で書き出します。</p>
  </header>

  <main class="workspace">
    <div class="area-preview">
      <PreviewPane config={previewConfig} {background} />
    </div>

    <div class="area-settings">
      <SettingsPanel bind:form bind:background {errors} />
    </div>

    <section class="area-export" aria-labelledby="export-title">
      <h2 id="export-title" class="visually-hidden">書き出し</h2>
      <div class="export-bar">
        <button
          type="button"
          class="primary"
          onclick={startExport}
          disabled={!parsed.success || exporting}
          aria-describedby="export-status"
          data-testid="export-button"
        >
          {exporting ? '送信中…' : '書き出しを開始'}
        </button>
        <div id="export-status" class="export-status" aria-live="polite">
          {#if errorCount > 0}
            <p class="error">入力内容に {errorCount} 件のエラーがあります。修正すると書き出せます。</p>
          {:else if notice}
            <p class:error={notice.kind === 'error'} data-testid="export-notice">{notice.text}</p>
          {:else}
            <p class="muted">
              {previewConfig.width}×{previewConfig.height} · {previewConfig.fps}fps · {previewConfig.durationSeconds}秒 をクラウドで書き出します
            </p>
          {/if}
        </div>
      </div>
    </section>

    <div class="area-jobs">
      <JobList
        {jobs}
        {currentHash}
        loading={listLoading}
        {loadingMore}
        hasMore={nextCursor !== null}
        error={listError}
        {retryingIds}
        {unavailableIds}
        onRetry={retry}
        onLoad={loadIntoEditor}
        onLoadMore={loadMore}
        onReload={refreshList}
      />
    </div>
  </main>
</div>

<style>
  :global(:root) {
    color-scheme: light;
    --bg: #ffffff;
    --text: #1f1f1f;
    --muted: #616161;
    --rule: #d4d4d4;
    --field-border: #a8a8a8;
    --subtle: #f5f5f5;
    --accent: #1a5fb4;
    --danger: #b42318;
    --font-ui: system-ui, -apple-system, 'Hiragino Sans', 'Hiragino Kaku Gothic ProN', 'Noto Sans JP', 'Segoe UI', sans-serif;
    --font-data: ui-monospace, 'SFMono-Regular', Menlo, Consolas, monospace;
  }

  :global(*),
  :global(*::before),
  :global(*::after) {
    box-sizing: border-box;
  }

  :global(body) {
    margin: 0;
    background: var(--bg);
    color: var(--text);
    font-family: var(--font-ui);
    font-size: 15px;
    line-height: 1.5;
  }

  :global(.mono) {
    font-family: var(--font-data);
  }

  :global(.visually-hidden) {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
    border: 0;
  }

  :global(.section-title) {
    margin: 0;
    font-size: 1rem;
    font-weight: 600;
  }

  :global(input),
  :global(select),
  :global(button) {
    font: inherit;
    color: inherit;
  }

  :global(input:not([type='range']):not([type='color'])),
  :global(select) {
    width: 100%;
    min-height: 2.25rem;
    padding: 0.3rem 0.5rem;
    background: #fff;
    border: 1px solid var(--field-border);
    border-radius: 3px;
    font-size: 0.9rem;
  }

  :global(input[type='color']) {
    background: #fff;
    border: 1px solid var(--field-border);
    border-radius: 3px;
  }

  :global(input[aria-invalid='true']),
  :global(select[aria-invalid='true']) {
    border-color: var(--danger);
  }

  :global(input[type='range']) {
    accent-color: var(--accent);
    min-height: 1.75rem;
  }

  :global(button) {
    min-height: 2.25rem;
    padding: 0.3rem 0.85rem;
    background: #fff;
    border: 1px solid var(--field-border);
    border-radius: 3px;
    cursor: pointer;
    font-size: 0.875rem;
  }

  :global(button:hover:not(:disabled)) {
    background: var(--subtle);
  }

  :global(button:disabled) {
    opacity: 0.5;
    cursor: not-allowed;
  }

  :global(a) {
    color: var(--accent);
  }

  :global(:focus-visible) {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  .app {
    max-width: 1280px;
    margin: 0 auto;
    padding: 1rem clamp(1rem, 3vw, 2rem) 2.5rem;
  }

  .header {
    padding-bottom: 0.75rem;
    margin-bottom: 1.25rem;
    border-bottom: 1px solid var(--rule);
  }

  h1 {
    margin: 0;
    font-size: 1.25rem;
    font-weight: 600;
  }

  .lead {
    margin: 0.2rem 0 0;
    color: var(--muted);
    font-size: 0.875rem;
  }

  /* Mobile: preview first, then settings, export, history. */
  .workspace {
    display: grid;
    gap: 1.5rem;
    grid-template-columns: minmax(0, 1fr);
    grid-template-areas:
      'preview'
      'settings'
      'export'
      'jobs';
  }

  .area-preview {
    grid-area: preview;
    min-width: 0;
  }

  .area-settings {
    grid-area: settings;
    min-width: 0;
  }

  .area-export {
    grid-area: export;
    min-width: 0;
  }

  .area-jobs {
    grid-area: jobs;
    min-width: 0;
  }

  .export-bar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem 1rem;
    padding: 0.75rem 0;
    border-top: 1px solid var(--rule);
    border-bottom: 1px solid var(--rule);
  }

  .primary {
    background: var(--accent);
    border-color: var(--accent);
    color: #fff;
  }

  .primary:hover:not(:disabled) {
    background: #164f96;
  }

  .export-status {
    flex: 1;
    min-width: 12rem;
  }

  .export-status p {
    margin: 0;
    font-size: 0.875rem;
  }

  .export-status .error {
    color: var(--danger);
  }

  .export-status .muted {
    color: var(--muted);
  }

  /* Desktop: settings left (sticky), preview / export / history right. */
  @media (min-width: 960px) {
    .workspace {
      grid-template-columns: minmax(280px, 340px) minmax(0, 1fr);
      grid-template-rows: auto auto 1fr;
      grid-template-areas:
        'settings preview'
        'settings export'
        'settings jobs';
      column-gap: 2rem;
      row-gap: 1.25rem;
      align-items: start;
    }

    .area-settings {
      position: sticky;
      top: 1rem;
      max-height: calc(100vh - 2rem);
      overflow-y: auto;
      padding-right: 1.5rem;
      border-right: 1px solid var(--rule);
    }
  }
</style>
