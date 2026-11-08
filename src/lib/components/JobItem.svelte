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
    /** Whether the inline MP4 preview is shown. */
    expanded: boolean;
    onRetry: (job: RenderJob) => void;
    onLoad: (job: RenderJob) => void;
    onTogglePreview: (job: RenderJob) => void;
  }

  let { job, currentHash, retrying, unavailable, expanded, onRetry, onLoad, onTogglePreview }: Props = $props();

  const progress = $derived(clampProgress(job.status === 'completed' ? 100 : job.progress));
  const differs = $derived(currentHash !== null && job.configHash !== currentHash);
  const active = $derived(isActiveJob(job) && !unavailable);
  const assets = $derived(job.status === 'completed' && !job.expired ? job.assets : null);
  const titleId = $derived(`job-${job.id}-title`);
  const videoId = $derived(`job-${job.id}-video`);
  const detailsId = $derived(`job-${job.id}-details`);
  let showDetails = $state(false);
</script>

<li class="job" data-status={job.status} data-testid="job-item" data-job-id={job.id} aria-labelledby={titleId}>
  <div class="row">
    <div class="main">
      <p class="title" id={titleId}>{summarizeRange(job.config)}</p>
      <p class="sub">
        <time datetime={job.createdAt} title={formatTimestamp(job.createdAt)}>{formatShortTimestamp(job.createdAt)}</time>
        {#if differs}{' · '}<span data-testid="job-differs">現在の設定とは異なる</span>{/if}
      </p>
    </div>

    <p class="state">
      {#if job.expired}
        <span class="muted" data-testid="job-expired">期限切れ</span>
      {:else}
        <span class:failed={job.status === 'failed'} data-testid="job-status">{STATUS_LABELS[job.status]}</span>
      {/if}
      {#if active}
        <span>{progress}%</span>
        {#if job.stage}<span class="muted" data-testid="job-stage">{STAGE_LABELS[job.stage]}</span>{/if}
      {/if}
    </p>

    {#if !active}
      <div class="actions">
        {#if assets}
          <button type="button" onclick={() => onTogglePreview(job)} aria-expanded={expanded} aria-controls={videoId}>
            プレビュー
          </button>
          <a href={assets.mp4.downloadUrl} download data-testid="download-mp4">MP4</a>
          <a href={assets.mov.downloadUrl} download data-testid="download-mov">MOV</a>
        {:else if job.status === 'failed'}
          <button type="button" onclick={() => onRetry(job)} disabled={retrying}>
            {retrying ? '再試行中…' : '再試行'}
          </button>
        {/if}
        <button
          type="button"
          class="text"
          onclick={() => (showDetails = !showDetails)}
          aria-expanded={showDetails}
          aria-controls={detailsId}
          data-testid="job-details-toggle"
        >
          詳細
        </button>
      </div>
    {/if}
  </div>

  {#if active}
    <progress
      max="100"
      value={progress}
      aria-label="進捗"
      aria-valuetext={`${progress}%${job.stage ? `、${STAGE_LABELS[job.stage]}` : ''}`}
    ></progress>
  {/if}

  {#if job.status === 'failed'}
    <p class="reason" role="status">{job.error?.message ?? '書き出しに失敗しました。'}</p>
  {/if}

  {#if unavailable}
    <p class="note" data-testid="job-unavailable">このジョブの情報を取得できなくなりました。削除された可能性があります。</p>
  {/if}

  {#if assets}
    <div id={videoId} hidden={!expanded}>
      {#if expanded}
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
    </div>
  {/if}

  {#if !active && showDetails}
    <div class="more" id={detailsId} data-testid="job-details">
      <dl>
        <div><dt>出力</dt><dd>{summarizeOutput(job.config)}</dd></div>
        <div><dt>文字</dt><dd>{summarizeStyle(job.config)}</dd></div>
        <div><dt>作成</dt><dd>{formatTimestamp(job.createdAt)}</dd></div>
        {#if job.status === 'failed' && job.stage}
          <div><dt>停止した段階</dt><dd>{STAGE_LABELS[job.stage]}</dd></div>
        {/if}
        {#if assets}
          <div><dt>サイズ</dt><dd>MP4 {formatBytes(assets.mp4.bytes)} · MOV {formatBytes(assets.mov.bytes)}</dd></div>
        {:else if job.expired}
          <div><dt>ファイル</dt><dd>保存期間が過ぎたため削除されました</dd></div>
        {/if}
      </dl>
      <button type="button" onclick={() => onLoad(job)}>エディターに読み込む</button>
    </div>
  {/if}
</li>

<style>
  .job {
    list-style: none;
    display: grid;
    gap: 0.4rem;
    padding: 0.6rem 0;
    border-top: 1px solid var(--rule);
    min-width: 0;
  }

  /* Columns line up across rows: identity | state | actions. */
  .row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 11rem 15rem;
    grid-template-areas: 'main state actions';
    align-items: center;
    gap: 0.25rem 1rem;
  }

  .main {
    grid-area: main;
    min-width: 0;
  }

  .title {
    margin: 0;
    font-size: 0.95rem;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    overflow-wrap: anywhere;
  }

  .sub {
    margin: 0;
    font-size: 0.8rem;
    color: var(--muted);
  }

  .state {
    grid-area: state;
    display: flex;
    flex-wrap: wrap;
    gap: 0 0.4rem;
    margin: 0;
    font-size: 0.875rem;
  }

  .failed {
    color: var(--danger);
  }

  .muted {
    color: var(--muted);
  }

  .actions {
    grid-area: actions;
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 0.75rem;
    font-size: 0.875rem;
  }

  @container job-list (max-width: 40rem) {
    .row {
      grid-template-columns: minmax(0, 1fr) auto;
      grid-template-areas:
        'main main'
        'state actions';
    }
  }

  .text {
    min-height: auto;
    padding: 0;
    border: 0;
    background: none;
    color: var(--muted);
    text-decoration: underline;
  }

  .text:hover:not(:disabled) {
    background: none;
    color: var(--text);
  }

  progress {
    width: 100%;
    height: 0.4rem;
  }

  .reason {
    margin: 0;
    font-size: 0.85rem;
    color: var(--danger);
    overflow-wrap: anywhere;
  }

  .note {
    margin: 0;
    font-size: 0.8rem;
    color: var(--muted);
  }

  video {
    display: block;
    width: 100%;
    max-width: 36rem;
    aspect-ratio: 16 / 9;
    background: #000;
  }

  .more {
    padding: 0.5rem 0.75rem;
    background: var(--subtle);
    font-size: 0.8rem;
    color: var(--muted);
  }

  .more dl {
    display: grid;
    gap: 0.15rem;
    margin: 0 0 0.5rem;
  }

  .more dl div {
    display: flex;
    gap: 0.75rem;
  }

  .more dt {
    flex: none;
    width: 6rem;
  }

  .more dd {
    margin: 0;
    color: var(--text);
    overflow-wrap: anywhere;
  }
</style>
