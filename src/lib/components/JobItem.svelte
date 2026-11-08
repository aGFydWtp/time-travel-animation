<script lang="ts">
  import type { RenderJob } from '../api/types.ts';
  import {
    STAGE_LABELS,
    STATUS_LABELS,
    clampProgress,
    formatBytes,
    formatTimestamp,
    summarizeConfig,
    summarizeStyle,
  } from '../ui/format.ts';
  import { isActiveJob } from '../ui/poll.ts';

  interface Props {
    job: RenderJob;
    /** Hash of the editor's current config (null until computed). */
    currentHash: string | null;
    retrying: boolean;
    onRetry: (job: RenderJob) => void;
    onLoad: (job: RenderJob) => void;
  }

  let { job, currentHash, retrying, onRetry, onLoad }: Props = $props();

  const progress = $derived(clampProgress(job.status === 'completed' ? 100 : job.progress));
  const differs = $derived(currentHash !== null && job.configHash !== currentHash);
  const active = $derived(isActiveJob(job));
  const titleId = $derived(`job-${job.id}-title`);
</script>

<li class="job" data-status={job.status} data-testid="job-item" data-job-id={job.id} aria-labelledby={titleId}>
  <div class="head">
    <div class="meta">
      <time class="mono created" datetime={job.createdAt}>{formatTimestamp(job.createdAt)}</time>
      <p class="summary" id={titleId}>{summarizeConfig(job.config)}</p>
      <p class="style">{summarizeStyle(job.config)}</p>
    </div>
    <div class="badges">
      <span class="status status-{job.status}" data-testid="job-status">{STATUS_LABELS[job.status]}</span>
      {#if job.expired}
        <span class="badge muted" data-testid="job-expired">期限切れ</span>
      {/if}
      {#if differs}
        <span class="badge outline" data-testid="job-differs">現在の設定とは異なる</span>
      {/if}
    </div>
  </div>

  {#if active || job.status === 'failed'}
    <div class="progress-row">
      <progress
        max="100"
        value={progress}
        aria-label="進捗"
        aria-valuetext={`${progress}%${job.stage ? `、${STAGE_LABELS[job.stage]}` : ''}`}
      ></progress>
      <span class="mono pct">{progress}%</span>
      {#if job.stage}
        <span class="stage" data-testid="job-stage">{STAGE_LABELS[job.stage]}</span>
      {/if}
    </div>
  {/if}

  {#if job.status === 'failed'}
    <div class="failure">
      <p class="error-text" role="status">
        {job.error?.message ?? '書き出しに失敗しました。'}
      </p>
      <button type="button" onclick={() => onRetry(job)} disabled={retrying}>
        {retrying ? '再試行中…' : '再試行'}
      </button>
    </div>
  {/if}

  {#if job.status === 'completed'}
    {#if job.assets && !job.expired}
      <!-- svelte-ignore a11y_media_has_caption -->
      <video
        controls
        preload="metadata"
        playsinline
        src={job.assets.mp4.url}
        aria-label="確認用 MP4（黒背景）"
        data-testid="job-video"
      ></video>
      <div class="downloads">
        <a class="button" href={job.assets.mp4.downloadUrl} download data-testid="download-mp4">
          MP4 をダウンロード <span class="size">{formatBytes(job.assets.mp4.bytes)}</span>
        </a>
        <a class="button" href={job.assets.mov.downloadUrl} download data-testid="download-mov">
          MOV（透過）をダウンロード <span class="size">{formatBytes(job.assets.mov.bytes)}</span>
        </a>
      </div>
      <p class="hint">MOV は ProRes 4444 の透過動画のため、ファイルサイズが大きくなります。MP4 は黒背景の確認用です。</p>
    {:else}
      <p class="hint">保存期間が過ぎたため、ファイルは削除されました。</p>
    {/if}
    <div class="actions">
      <button type="button" class="ghost" onclick={() => onLoad(job)}>エディターに読み込む</button>
    </div>
  {:else if job.status === 'failed'}
    <div class="actions">
      <button type="button" class="ghost" onclick={() => onLoad(job)}>エディターに読み込む</button>
    </div>
  {/if}
</li>

<style>
  .job {
    list-style: none;
    display: grid;
    gap: 0.75rem;
    padding: 1rem;
    border: 1px solid var(--rule);
    border-left: 3px solid var(--rule);
    border-radius: 6px;
    background: var(--surface);
    min-width: 0;
  }

  .job[data-status='running'],
  .job[data-status='queued'] {
    border-left-color: var(--tally);
  }

  .job[data-status='completed'] {
    border-left-color: var(--ok);
  }

  .job[data-status='failed'] {
    border-left-color: var(--danger);
  }

  .head {
    display: flex;
    gap: 0.75rem;
    justify-content: space-between;
    align-items: flex-start;
    flex-wrap: wrap;
  }

  .meta {
    display: grid;
    gap: 0.2rem;
    min-width: 0;
  }

  .created {
    font-size: 0.74rem;
    color: var(--muted);
  }

  .summary {
    margin: 0;
    font-size: 0.9rem;
    overflow-wrap: anywhere;
  }

  .style {
    margin: 0;
    font-size: 0.76rem;
    color: var(--text-dim);
    overflow-wrap: anywhere;
  }

  .badges {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
  }

  .status,
  .badge {
    font-size: 0.72rem;
    padding: 0.18rem 0.55rem;
    border-radius: 999px;
    white-space: nowrap;
  }

  .status-queued,
  .status-running {
    background: color-mix(in srgb, var(--tally) 18%, transparent);
    color: var(--tally);
  }

  .status-completed {
    background: color-mix(in srgb, var(--ok) 18%, transparent);
    color: var(--ok);
  }

  .status-failed {
    background: color-mix(in srgb, var(--danger) 18%, transparent);
    color: var(--danger);
  }

  .badge.muted {
    background: var(--surface-2);
    color: var(--muted);
  }

  .badge.outline {
    border: 1px solid var(--muted);
    color: var(--text-dim);
  }

  .progress-row {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    flex-wrap: wrap;
  }

  progress {
    flex: 1;
    min-width: 8rem;
    height: 6px;
    appearance: none;
    border: 0;
    border-radius: 3px;
    background: var(--surface-2);
    overflow: hidden;
  }

  progress::-webkit-progress-bar {
    background: var(--surface-2);
  }

  progress::-webkit-progress-value {
    background: var(--tally);
  }

  progress::-moz-progress-bar {
    background: var(--tally);
  }

  .pct {
    font-size: 0.78rem;
    color: var(--text-dim);
    min-width: 3ch;
  }

  .stage {
    font-size: 0.76rem;
    color: var(--muted);
  }

  .failure {
    display: flex;
    gap: 0.75rem;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
  }

  .error-text {
    margin: 0;
    color: var(--danger);
    font-size: 0.84rem;
    overflow-wrap: anywhere;
  }

  video {
    width: 100%;
    aspect-ratio: 16 / 9;
    background: #000;
    border-radius: 4px;
  }

  .downloads,
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }

  .size {
    color: var(--muted);
    font-size: 0.76rem;
  }

  .hint {
    margin: 0;
    font-size: 0.74rem;
    color: var(--muted);
  }
</style>
