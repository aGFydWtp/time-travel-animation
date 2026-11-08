<script lang="ts">
  import { onMount } from 'svelte';
  import '../src/lib/ui/global.css';
  import { ApiError, api, describeApiError } from '../src/lib/api/client.ts';
  import ExportResult from '../src/lib/components/ExportResult.svelte';
  import PreviewPane from '../src/lib/components/PreviewPane.svelte';
  import SettingsPanel from '../src/lib/components/SettingsPanel.svelte';
  import SiteHeader from '../src/lib/components/SiteHeader.svelte';
  import { hashConfig, safeParseRenderConfig } from '../src/lib/renderer/schema.ts';
  import { DEFAULT_CONFIG, type RenderConfig } from '../src/lib/renderer/types.ts';
  import {
    defaultForm,
    fieldErrors,
    formFromConfig,
    formToConfigInput,
  } from '../src/lib/ui/editor-form.ts';
  import { clampProgress } from '../src/lib/ui/format.ts';
  import { IdempotencyKeys, isTerminalCreateError } from '../src/lib/ui/idempotency.ts';
  import { JobTracker } from '../src/lib/ui/job-tracker.svelte.ts';
  import { saveLastConfig } from '../src/lib/ui/last-config.ts';
  import { isActiveJob } from '../src/lib/ui/poll.ts';

  // ---- editor ----------------------------------------------------------
  let form = $state(defaultForm());

  const parsed = $derived(safeParseRenderConfig(formToConfigInput(form)));
  const errors = $derived(parsed.success ? {} : fieldErrors(parsed.error.issues));
  const errorCount = $derived(Object.keys(errors).length);

  // The preview keeps showing the last valid config while a field is mid-edit.
  let lastValid: RenderConfig = { ...DEFAULT_CONFIG };
  const previewConfig = $derived.by(() => {
    if (parsed.success) lastValid = parsed.data;
    return lastValid;
  });

  // /history reads this to mark the job made with the current settings.
  $effect(() => {
    saveLastConfig(previewConfig);
  });

  // Hash of the current settings, to tell whether the tracked export still matches them.
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
  const tracker = new JobTracker(api, { mode: 'single' });
  const trackedJob = $derived(tracker.jobs[0] ?? null);

  // The button carries the export state: idle → busy (progress inside) → idle again.
  const busy = $derived(
    trackedJob !== null && isActiveJob(trackedJob) && !tracker.unavailableIds.has(trackedJob.id) && !tracker.authLost,
  );
  const busyPct = $derived(busy && trackedJob?.status === 'running' ? clampProgress(trackedJob.progress) : 0);
  const busyLabel = $derived(trackedJob?.status === 'running' ? `書き出し中… ${busyPct}%` : '待機中…');
  const settingsChanged = $derived(trackedJob !== null && currentHash !== null && trackedJob.configHash !== currentHash);
  const finishedJob = $derived(
    trackedJob && (trackedJob.status === 'completed' || trackedJob.status === 'failed') ? trackedJob : null,
  );

  async function startExport() {
    if (!parsed.success || exporting || busy) return;
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
      // The inline status line below says it started; only a reused job needs a note.
      if (res.reused) notice = { kind: 'ok', text: '同じ設定の書き出しが進行中です' };
      await tracker.track(res.id);
    } catch (error) {
      notice = { kind: 'error', text: describeApiError(error) };
    } finally {
      exporting = false;
    }
  }

  /** `/?from=<jobId>` (from 「エディターに読み込む」 on /history) loads that job's settings. */
  async function loadFromJob(id: string) {
    try {
      const job = await api.getRender(id);
      const config = safeParseRenderConfig(job.config);
      if (!config.success) {
        notice = { kind: 'error', text: 'この書き出しの設定は読み込めませんでした' };
        return;
      }
      form = formFromConfig(config.data);
      notice = { kind: 'ok', text: '設定を読み込みました' };
    } catch (error) {
      notice = {
        kind: 'error',
        text:
          error instanceof ApiError && error.status === 404
            ? '指定された書き出しが見つかりませんでした'
            : describeApiError(error),
      };
    }
  }

  onMount(() => {
    const from = new URL(window.location.href).searchParams.get('from');
    if (from) void loadFromJob(from);
    return () => tracker.dispose();
  });
</script>

<div class="app">
  <SiteHeader current="editor" />

  <main class="workspace">
    <SettingsPanel bind:form {errors} />

    <div class="group">
      <PreviewPane config={previewConfig} />

      <section class="export" aria-labelledby="export-title">
        <h2 id="export-title" class="visually-hidden">書き出し</h2>
        <div class="cta">
          <button
            type="button"
            class="primary"
            class:busy
            onclick={startExport}
            disabled={!parsed.success || exporting || busy}
            aria-describedby="export-summary"
            style:--pct={`${busyPct}%`}
            data-testid="export-button"
          >
            {#if busy}
              <span class="label">{busyLabel}</span>
              <span class="label fill" aria-hidden="true">{busyLabel}</span>
            {:else}
              {exporting ? '送信中…' : '書き出す'}
            {/if}
          </button>
          {#if busy}
            <span
              class="visually-hidden"
              role="progressbar"
              aria-label="書き出しの進捗"
              aria-valuemin="0"
              aria-valuemax="100"
              aria-valuenow={busyPct}
              aria-valuetext={busyLabel}
              data-testid="export-progress"
            ></span>
          {/if}
          <p class="muted" id="export-summary" data-testid="export-summary">
            {busy ? '現在の設定 ' : ''}{previewConfig.width}×{previewConfig.height} · {previewConfig.fps}fps · {previewConfig.durationSeconds}秒 → 確認用MP4・透過MOV
            {#if busy && settingsChanged}<span>（書き出し中の設定とは異なります）</span>{/if}
          </p>
        </div>

        <div class="status" aria-live="polite">
          {#if errorCount > 0}
            <p class="error">入力内容に {errorCount} 件のエラーがあります</p>
          {:else if notice}
            <p class:error={notice.kind === 'error'} class:muted={notice.kind === 'ok'} data-testid="export-notice">{notice.text}</p>
          {/if}
          {#if tracker.error}
            <p class="error" role="alert">{tracker.error}</p>
          {:else if trackedJob && tracker.unavailableIds.has(trackedJob.id)}
            <p class="muted">書き出しの情報を取得できません</p>
          {/if}
          {#if finishedJob && !busy}
            <ExportResult job={finishedJob} stale={settingsChanged} />
          {/if}
        </div>
      </section>
    </div>
  </main>
</div>

<style>
  .workspace {
    display: grid;
    gap: 48px;
    grid-template-columns: minmax(0, 1fr);
  }

  .group {
    display: grid;
    gap: 32px;
    min-width: 0;
  }

  .export {
    display: grid;
    gap: 16px;
  }

  /* Button + the line describing what it will produce = one group. */
  .cta {
    display: grid;
    gap: 4px;
    justify-items: start;
  }

  .primary {
    position: relative;
    min-width: 11em;
    min-height: 40px;
    padding: 0 20px;
    border-radius: 9999px;
    background: var(--ink);
    color: #fff;
    font-size: 15px;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }

  .primary:hover:not(:disabled) {
    background: #333;
  }

  /* Busy: the pill is the progress bar. Dark fill grows left→right; a white copy of the label is clipped to it. */
  .primary.busy {
    overflow: hidden;
    background: #e6e6e6;
    color: var(--ink);
    opacity: 1;
    cursor: progress;
  }

  .primary.busy .fill {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--ink);
    color: #fff;
    clip-path: inset(0 calc(100% - var(--pct)) 0 0);
    transition: clip-path 0.3s ease-out;
  }

  @media (prefers-reduced-motion: reduce) {
    .primary.busy .fill {
      transition: none;
    }
  }

  .export p {
    margin: 0;
    font-size: 13px;
  }

  .muted {
    color: var(--muted);
  }

  .status {
    display: grid;
    gap: 8px;
  }

  .status:empty {
    display: none;
  }

  .error {
    color: var(--danger);
  }
</style>
