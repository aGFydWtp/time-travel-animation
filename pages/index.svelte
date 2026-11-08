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
  import { POLL_MIN_MS, isActiveJob, jobChanged, mergeJobs, nextPollDelay } from '../src/lib/ui/poll.ts';

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

  async function startExport() {
    if (!parsed.success || exporting) return;
    const config = parsed.data;
    exporting = true;
    notice = null;
    try {
      const res = await api.createRender(config, crypto.randomUUID());
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
      listError = `続きを取得できませんでした。${describeApiError(error)}`;
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

  function schedulePoll() {
    clearTimeout(pollTimer);
    if (disposed || polling || !jobs.some(isActiveJob)) return;
    pollTimer = setTimeout(pollOnce, pollDelay);
  }

  async function pollOnce() {
    polling = true;
    let changed = false;
    let finished = false;
    try {
      const active = jobs.filter(isActiveJob);
      const results = await Promise.allSettled(active.map((j) => api.getRender(j.id)));
      const fresh: RenderJob[] = [];
      results.forEach((result, i) => {
        if (result.status !== 'fulfilled') return;
        const before = active[i];
        if (jobChanged(before, result.value)) changed = true;
        if (!isActiveJob(result.value)) finished = true;
        fresh.push(result.value);
      });
      if (fresh.length > 0) jobs = mergeJobs(jobs, fresh);
    } finally {
      polling = false;
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
  <header class="masthead">
    <h1>{title}</h1>
    <p class="tagline">日付が流れるカウントダウン動画を作って、透過 MOV と確認用 MP4 で書き出します。</p>
  </header>

  <main class="workspace">
    <div class="area-preview">
      <PreviewPane config={previewConfig} {background} />
    </div>

    <div class="area-settings panel">
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
            <p class={notice.kind === 'error' ? 'error' : 'ok'} data-testid="export-notice">{notice.text}</p>
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
    color-scheme: dark;
    --bg: #12161c;
    --surface: #181d24;
    --surface-2: #1f262f;
    --rule: #2c3540;
    --text: #e6e9ed;
    --text-dim: #b3bcc6;
    --muted: #8691a0;
    --tally: #ffb547;
    --on-tally: #1a1206;
    --ok: #74d3a0;
    --danger: #ff7a6b;
    --focus: #8fc1ff;
    --font-ui: 'Hiragino Sans', 'Hiragino Kaku Gothic ProN', 'Noto Sans JP', system-ui, sans-serif;
    --font-data: 'DCS JetBrains Mono', ui-monospace, 'SFMono-Regular', Menlo, monospace;
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
    -webkit-font-smoothing: antialiased;
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
    font-size: 0.8rem;
    font-weight: 600;
    letter-spacing: 0.16em;
    color: var(--text-dim);
  }

  :global(input),
  :global(select),
  :global(button),
  :global(a.button) {
    font: inherit;
    color: inherit;
  }

  :global(input:not([type='range']):not([type='color'])),
  :global(select) {
    width: 100%;
    min-height: 2.5rem;
    padding: 0.45rem 0.65rem;
    background: var(--surface-2);
    border: 1px solid var(--rule);
    border-radius: 5px;
    font-size: 0.92rem;
  }

  :global(input[type='color']) {
    background: var(--surface-2);
    border: 1px solid var(--rule);
    border-radius: 5px;
  }

  :global(input[aria-invalid='true']),
  :global(select[aria-invalid='true']) {
    border-color: var(--danger);
  }

  :global(input[type='range']) {
    accent-color: var(--tally);
    min-height: 2rem;
  }

  :global(button),
  :global(a.button) {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.45rem;
    min-height: 2.5rem;
    padding: 0.45rem 0.95rem;
    background: var(--surface-2);
    border: 1px solid var(--rule);
    border-radius: 5px;
    cursor: pointer;
    text-decoration: none;
    font-size: 0.88rem;
  }

  :global(button:hover:not(:disabled)),
  :global(a.button:hover) {
    border-color: var(--muted);
  }

  :global(button:disabled) {
    opacity: 0.45;
    cursor: not-allowed;
  }

  :global(button.ghost) {
    background: transparent;
  }

  :global(button.small) {
    min-height: 2.1rem;
    padding: 0.3rem 0.7rem;
    font-size: 0.8rem;
  }

  :global(:focus-visible) {
    outline: 2px solid var(--focus);
    outline-offset: 2px;
  }

  @media (prefers-reduced-motion: reduce) {
    :global(*) {
      scroll-behavior: auto !important;
    }
  }

  .app {
    max-width: 1440px;
    margin: 0 auto;
    padding: 1.5rem clamp(1rem, 3vw, 2.5rem) 3rem;
  }

  .masthead {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0.4rem 1.25rem;
    padding-bottom: 1.25rem;
    margin-bottom: 1.5rem;
    border-bottom: 1px solid var(--rule);
  }

  h1 {
    margin: 0;
    font-family: var(--font-data);
    font-weight: 400;
    font-size: 1.15rem;
    letter-spacing: 0.04em;
  }

  .tagline {
    margin: 0;
    color: var(--muted);
    font-size: 0.84rem;
  }

  /* Mobile: preview first, then settings, export, history. */
  .workspace {
    display: grid;
    gap: 1.75rem;
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

  .panel {
    padding: 1.1rem;
    background: var(--surface);
    border: 1px solid var(--rule);
    border-radius: 8px;
  }

  .export-bar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.75rem 1rem;
  }

  .primary {
    background: var(--tally);
    border-color: var(--tally);
    color: var(--on-tally);
    font-weight: 600;
    min-height: 2.9rem;
    padding: 0.55rem 1.4rem;
  }

  .primary:hover:not(:disabled) {
    border-color: var(--tally);
    filter: brightness(1.08);
  }

  .export-status {
    flex: 1;
    min-width: 12rem;
  }

  .export-status p {
    margin: 0;
    font-size: 0.84rem;
  }

  .export-status .error {
    color: var(--danger);
  }

  .export-status .ok {
    color: var(--ok);
  }

  .export-status .muted {
    color: var(--muted);
  }

  /* Desktop: settings left (sticky), preview / export / history right. */
  @media (min-width: 960px) {
    .workspace {
      grid-template-columns: minmax(300px, 360px) minmax(0, 1fr);
      grid-template-rows: auto auto 1fr;
      grid-template-areas:
        'settings preview'
        'settings export'
        'settings jobs';
      column-gap: 2rem;
      row-gap: 1.5rem;
      align-items: start;
    }

    .area-settings {
      position: sticky;
      top: 1rem;
      max-height: calc(100vh - 2rem);
      overflow-y: auto;
    }
  }
</style>
