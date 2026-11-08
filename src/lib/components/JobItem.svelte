<script lang="ts">
  import type { RenderJob } from '../api/types.ts';
  import {
    STAGE_LABELS,
    STATUS_LABELS,
    clampProgress,
    formatShortTimestamp,
    formatTimestamp,
    summarizeOutput,
    summarizeRange,
    summarizeStyle,
  } from '../ui/format.ts';
  import { isActiveJob } from '../ui/poll.ts';
  import DownloadLinks from './DownloadLinks.svelte';

  interface Props {
    job: RenderJob;
    /** Hash of the editor's current config (null until computed). */
    currentHash: string | null;
    retrying: boolean;
    /** The job returned 404 while polling and is no longer tracked. */
    unavailable: boolean;
    onRetry: (job: RenderJob) => void;
  }

  let { job, currentHash, retrying, unavailable, onRetry }: Props = $props();

  const progress = $derived(clampProgress(job.progress));
  const isCurrent = $derived(currentHash !== null && job.configHash === currentHash);
  const active = $derived(isActiveJob(job) && !unavailable);
  const assets = $derived(job.status === 'completed' && !job.expired ? job.assets : null);
  const stage = $derived(job.stage ? STAGE_LABELS[job.stage] : null);
  const titleId = $derived(`job-${job.id}-title`);
  const panelId = $derived(`job-${job.id}-panel`);
  let open = $state(false);
</script>

<li
  class="job"
  class:muted-row={job.expired}
  data-status={job.status}
  data-testid="job-item"
  data-job-id={job.id}
  aria-labelledby={titleId}
>
  <p class="title" id={titleId}>{summarizeRange(job.config)}</p>
      <p class="meta">
        <time datetime={job.createdAt} title={formatTimestamp(job.createdAt)}>{formatShortTimestamp(job.createdAt)}</time>
        {#if isCurrent}{' · '}<span data-testid="job-current">今の設定</span>{/if}
        {#if job.expired}
          {' · '}<span data-testid="job-expired">期限切れ</span>
        {:else if job.status === 'failed'}
          {' · '}<span class="failed"
            ><span data-testid="job-status">{STATUS_LABELS.failed}</span>：{job.error?.message ?? '書き出しに失敗しました。'}</span
          >
        {:else if unavailable}
          {' · '}<span data-testid="job-unavailable">情報を取得できません（削除された可能性があります）</span>
        {:else if active}
          {' · '}<span class="progress-group">
            <span data-testid="job-status" class:visually-hidden={job.status === 'running' && stage}
              >{STATUS_LABELS[job.status]}</span
            >
            {#if job.status === 'running' && stage}<span data-testid="job-stage">{stage}</span>{/if}
            {#if job.status === 'running'}
              <progress
                max="100"
                value={progress}
                aria-label="進捗"
                aria-valuetext={`${progress}%${stage ? `、${stage}` : ''}`}
              ></progress>
              <span class="pct">{progress}%</span>
            {/if}
          </span>
        {/if}
      </p>

  {#if !active}
    <div class="actions">
      {#if assets}
        <DownloadLinks mov={assets.mov} mp4={assets.mp4} />
      {:else if job.status === 'failed'}
        <button type="button" class="action strong" onclick={() => onRetry(job)} disabled={retrying}>
          {retrying ? '書き出し中…' : 'もう一度書き出す'}
        </button>
      {/if}
      <button
        type="button"
        class="action"
        onclick={() => (open = !open)}
        aria-expanded={open}
        aria-controls={panelId}
        data-testid="job-details-toggle"
      >
        {#if open}
          閉じる
        {:else if assets}
          <svg class="icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M5 3.5v9l7.5-4.5z" /></svg>再生して確認
        {:else}
          設定を見る
        {/if}
      </button>
    </div>
  {/if}

  {#if open && !active}
    <div class="panel" id={panelId} data-testid="job-details">
      {#if assets}
        <!-- svelte-ignore a11y_media_has_caption -->
        <video
          controls
          preload="metadata"
          playsinline
          src={assets.mp4.url}
          aria-label="確認用 MP4（黒背景）"
          data-testid="job-video"
        ></video>
      {/if}
      <p class="settings-line">
        {summarizeOutput(job.config)} · {summarizeStyle(job.config)}
        {#if job.status === 'failed' && stage}· 停止した段階：{stage}{/if}
        {#if job.expired}· 保存期間が過ぎたためファイルは削除されました{/if}
      </p>
      <a class="load" href={`/?from=${encodeURIComponent(job.id)}`}>この設定をエディターで開く</a>
    </div>
  {/if}
</li>

<style>
  /* One job = one plain card (fill only: no border, shadow or edge colour). Not clickable as a whole, so no hover. */
  .job {
    list-style: none;
    display: grid;
    gap: 2px;
    justify-items: start;
    min-width: 0;
    padding: 16px;
    border-radius: 8px;
    background: var(--card);
  }

  .title {
    margin: 0;
    font-size: 15px;
    font-weight: 500;
    font-variant-numeric: tabular-nums;
    overflow-wrap: anywhere;
  }

  .muted-row .title {
    color: var(--muted);
  }

  .meta {
    margin: 0;
    font-size: 13px;
    color: var(--muted);
    font-variant-numeric: tabular-nums;
    overflow-wrap: anywhere;
  }

  .failed {
    color: var(--danger);
  }

  .progress-group {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    white-space: nowrap;
    vertical-align: bottom;
  }

  /* Compact inline indicator, same look as the seek bar. */
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

  .actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0 20px;
    font-size: 13px;
  }

  .action {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    min-height: 32px;
    padding: 0;
    background: none;
    color: var(--ink);
    font-size: 13px;
  }

  .action:hover:not(:disabled) {
    background: none;
    text-decoration: underline;
  }

  .icon {
    width: 12px;
    height: 12px;
    fill: currentColor;
  }

  /* Phones: one action per line, each a 32px tap row, still directly under its job. */
  @media (max-width: 639px) {
    .job {
      padding: 12px;
    }

    .actions {
      flex-direction: column;
      align-items: flex-start;
    }
  }

  .strong {
    color: var(--ink);
    font-weight: 600;
  }

  .panel {
    display: grid;
    gap: 8px;
    justify-items: start;
    width: 100%;
    max-width: 560px;
    margin-top: 8px;
  }

  video {
    display: block;
    width: 100%;
    aspect-ratio: 16 / 9;
    background: #000;
  }

  .settings-line {
    margin: 0;
    font-size: 13px;
    color: var(--muted);
    overflow-wrap: anywhere;
  }

  /* White on the grey card so it still reads as a button. */
  .load {
    display: inline-flex;
    align-items: center;
    min-height: 32px;
    padding: 4px 16px;
    border-radius: 4px;
    background: #fff;
    color: var(--ink);
    font-size: 13px;
    text-decoration: none;
  }

  .load:hover {
    background: var(--hover);
  }
</style>
