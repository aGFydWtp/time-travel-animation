<script lang="ts">
  import { onMount } from 'svelte';
  import '../src/lib/ui/global.css';
  import { ApiError, api, describeApiError } from '../src/lib/api/client.ts';
  import ExportJobStatus from '../src/lib/components/ExportJobStatus.svelte';
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
  import { IdempotencyKeys, isTerminalCreateError } from '../src/lib/ui/idempotency.ts';
  import { JobTracker } from '../src/lib/ui/job-tracker.svelte.ts';
  import { saveLastConfig } from '../src/lib/ui/last-config.ts';

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

  // ---- export ----------------------------------------------------------
  let exporting = $state(false);
  let notice: { kind: 'ok' | 'error'; text: string } | null = $state(null);
  const idempotencyKeys = new IdempotencyKeys();
  const tracker = new JobTracker(api, { mode: 'single' });
  const trackedJob = $derived(tracker.jobs[0] ?? null);

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
        <div class="export-row">
          <button
            type="button"
            class="primary"
            onclick={startExport}
            disabled={!parsed.success || exporting}
            aria-describedby="export-note export-status"
            data-testid="export-button"
          >
            {exporting ? '送信中…' : '書き出す'}
          </button>
          <span class="muted">{previewConfig.width}×{previewConfig.height} · {previewConfig.fps}fps · {previewConfig.durationSeconds}秒</span>
        </div>
        <p class="muted" id="export-note">確認用MP4と透過MOVを作成します</p>
        <div id="export-status" class="status" aria-live="polite">
          {#if errorCount > 0}
            <p class="error">入力内容に {errorCount} 件のエラーがあります</p>
          {:else if notice}
            <p class:error={notice.kind === 'error'} data-testid="export-notice">{notice.text}</p>
          {/if}
          {#if trackedJob}
            <ExportJobStatus
              job={trackedJob}
              unavailable={tracker.unavailableIds.has(trackedJob.id)}
              retrying={tracker.retryingIds.has(trackedJob.id)}
              onRetry={(job) => tracker.retry(job)}
            />
          {/if}
          {#if tracker.error}
            <p class="error" role="alert">{tracker.error}</p>
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
    gap: 16px;
    min-width: 0;
  }

  .export {
    display: grid;
    gap: 4px;
  }

  .export-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px 16px;
  }

  .primary {
    min-height: 40px;
    padding: 8px 24px;
    background: var(--ink);
    color: #fff;
    font-size: 15px;
    font-weight: 600;
  }

  .primary:hover:not(:disabled) {
    background: #333;
  }

  .export p {
    margin: 0;
  }

  .muted {
    color: var(--muted);
    font-size: 13px;
  }

  .status {
    display: grid;
    gap: 4px;
    font-size: 13px;
  }

  .error {
    color: var(--danger);
  }
</style>
