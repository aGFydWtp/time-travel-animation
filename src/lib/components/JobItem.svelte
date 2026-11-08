<script lang="ts">
  import type { RenderJob } from '../api/types.ts';
  import {
    STAGE_LABELS,
    STATUS_LABELS,
    clampProgress,
    formatBytes,
    formatShortTimestamp,
    formatTimestamp,
    summarizeOutput,
    summarizeRange,
    summarizeStyle,
  } from '../ui/format.ts';
  import { isActiveJob } from '../ui/poll.ts';

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
  <div class="row">
    <div class="main">
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
    </div>

    {#if !active}
      <div class="actions">
        {#if assets}
          <a class="primary-link" href={assets.mov.downloadUrl} download data-testid="download-mov">
            MOV {formatBytes(assets.mov.bytes)}
          </a>
          <a class="secondary-link" href={assets.mp4.downloadUrl} download data-testid="download-mp4">
            MP4 {formatBytes(assets.mp4.bytes)}
          </a>
        {:else if job.status === 'failed'}
          <button type="button" class="text strong" onclick={() => onRetry(job)} disabled={retrying}>
            {retrying ? '再試行中…' : '再試行'}
          </button>
        {/if}
        <button
          type="button"
          class="text"
          onclick={() => (open = !open)}
          aria-expanded={open}
          aria-controls={panelId}
          data-testid="job-details-toggle"
        >
          確認
        </button>
      </div>
    {/if}
  </div>

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
      <a class="load" href={`/?from=${encodeURIComponent(job.id)}`}>エディターに読み込む</a>
    </div>
  {/if}
</li>

<style>
  /* Rows are separated by rhythm only; a faint tint on hover, nothing at rest. */
  .job {
    list-style: none;
    display: grid;
    gap: 8px;
    padding: 8px;
    margin: 0 -8px;
    border-radius: 4px;
    min-width: 0;
  }

  .job:hover {
    background: var(--row-hover);
  }

  .row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 4px 16px;
  }

  .main {
    flex: 1 1 18rem;
    min-width: 0;
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
    align-items: center;
    gap: 16px;
    margin-left: auto;
    font-size: 13px;
  }

  .actions a {
    text-decoration: none;
  }

  .actions a:hover {
    text-decoration: underline;
  }

  .primary-link {
    color: var(--ink);
    font-weight: 600;
  }

  .secondary-link {
    color: var(--muted);
  }

  .strong {
    color: var(--ink);
    font-weight: 600;
  }

  .panel {
    display: grid;
    gap: 8px;
    justify-items: start;
  }

  video {
    display: block;
    width: 100%;
    aspect-ratio: 16 / 9;
    background: #000;
  }

  .load {
    display: inline-flex;
    align-items: center;
    min-height: 32px;
    padding: 4px 16px;
    border-radius: 4px;
    background: var(--field);
    color: var(--ink);
    font-size: 13px;
    text-decoration: none;
  }

  .load:hover {
    background: var(--subtle);
  }

  .settings-line {
    margin: 0;
    font-size: 13px;
    color: var(--muted);
    overflow-wrap: anywhere;
  }

  @media (max-width: 767px) {
    .actions a {
      padding: 10px 4px;
    }
  }
</style>
