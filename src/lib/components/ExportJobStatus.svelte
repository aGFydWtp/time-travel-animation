<script lang="ts">
  import type { RenderJob } from '../api/types.ts';
  import { STAGE_LABELS, clampProgress } from '../ui/format.ts';
  import DownloadLinks from './DownloadLinks.svelte';

  interface Props {
    job: RenderJob;
    unavailable: boolean;
    retrying: boolean;
    onRetry: (job: RenderJob) => void;
  }

  let { job, unavailable, retrying, onRetry }: Props = $props();

  const progress = $derived(clampProgress(job.progress));
  const assets = $derived(job.status === 'completed' && !job.expired ? job.assets : null);
  const stage = $derived(job.stage ? STAGE_LABELS[job.stage] : null);
</script>

<p class="status" data-testid="export-job" data-status={job.status}>
  {#if unavailable}
    <span>書き出しの情報を取得できません</span>
  {:else if job.status === 'queued'}
    <span>待機中</span>
  {:else if job.status === 'running'}
    <span class="progress-group">
      <span>書き出し中</span>
      <progress max="100" value={progress} aria-label="進捗" aria-valuetext={`${progress}%${stage ? `、${stage}` : ''}`}
      ></progress>
      <span class="pct">{progress}%</span>
    </span>
  {:else if job.status === 'completed'}
    <span class="done">完了</span>
    {#if assets}
      <DownloadLinks mov={assets.mov} mp4={assets.mp4} />
    {/if}
  {:else}
    <span class="failed">失敗：{job.error?.message ?? '書き出しに失敗しました。'}</span>
    <button type="button" class="text" onclick={() => onRetry(job)} disabled={retrying}>
      {retrying ? '書き出し中…' : 'もう一度書き出す'}
    </button>
  {/if}
  <a class="history" href="/history">一覧を見る →</a>
</p>

<style>
  .status {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0 16px;
    margin: 0;
    font-size: 13px;
    color: var(--muted);
    font-variant-numeric: tabular-nums;
    overflow-wrap: anywhere;
  }

  .progress-group {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    white-space: nowrap;
  }

  progress {
    width: 88px;
    height: 4px;
    appearance: none;
    border: 0;
    border-radius: 2px;
    background: var(--track);
    overflow: hidden;
  }

  progress::-webkit-progress-bar {
    background: var(--track);
  }

  progress::-webkit-progress-value {
    background: var(--ink);
  }

  progress::-moz-progress-bar {
    background: var(--ink);
  }

  .pct {
    color: var(--ink);
  }

  .history {
    display: inline-flex;
    align-items: center;
    min-height: 32px;
    color: var(--muted);
    text-decoration: none;
  }

  .history:hover {
    color: var(--ink);
    text-decoration: underline;
  }

  .done {
    color: var(--ink);
  }

  .failed {
    color: var(--danger);
  }

  .text {
    min-height: 32px;
    padding: 0;
    color: var(--ink);
    font-size: 13px;
  }
</style>
