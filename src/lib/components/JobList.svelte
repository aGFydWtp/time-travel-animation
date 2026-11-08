<script lang="ts">
  import type { RenderJob } from '../api/types.ts';
  import JobItem from './JobItem.svelte';

  interface Props {
    jobs: RenderJob[];
    currentHash: string | null;
    loading: boolean;
    loadingMore: boolean;
    hasMore: boolean;
    error: string | null;
    retryingIds: ReadonlySet<string>;
    unavailableIds: ReadonlySet<string>;
    onRetry: (job: RenderJob) => void;
    onLoad: (job: RenderJob) => void;
    onLoadMore: () => void;
    onReload: () => void;
  }

  let {
    jobs,
    currentHash,
    loading,
    loadingMore,
    hasMore,
    error,
    retryingIds,
    unavailableIds,
    onRetry,
    onLoad,
    onLoadMore,
    onReload,
  }: Props = $props();

  const hasAssets = (job: RenderJob) => job.status === 'completed' && !job.expired && job.assets !== null;
  // Only one inline preview at a time. Until the user picks one, the newest finished job is open.
  let chosenId: string | null | undefined = $state(undefined);
  const expandedId = $derived(chosenId === undefined ? (jobs.find(hasAssets)?.id ?? null) : chosenId);
  const anyAssets = $derived(jobs.some(hasAssets));

  function togglePreview(job: RenderJob) {
    chosenId = expandedId === job.id ? null : job.id;
  }
</script>

<section class="jobs" aria-labelledby="jobs-title" aria-busy={loading}>
  <div class="jobs-head">
    <h2 id="jobs-title" class="section-title">書き出し履歴</h2>
    <button type="button" onclick={onReload} disabled={loading}>一覧を更新</button>
  </div>

  {#if error}
    <p class="error" role="alert">{error}</p>
  {/if}

  {#if loading && jobs.length === 0}
    <p class="empty">読み込み中…</p>
  {:else if jobs.length === 0 && !error}
    <p class="empty">まだ書き出しはありません。設定を決めたら「書き出しを開始」を押してください。</p>
  {:else}
    <ul class="list" data-testid="job-list">
      {#each jobs as job (job.id)}
        <JobItem
          {job}
          {currentHash}
          retrying={retryingIds.has(job.id)}
          unavailable={unavailableIds.has(job.id)}
          expanded={expandedId === job.id}
          {onRetry}
          {onLoad}
          onTogglePreview={togglePreview}
        />
      {/each}
    </ul>
    {#if anyAssets}
      <p class="empty">MOV は ProRes 4444 の透過動画のためファイルサイズが大きくなります。MP4 は黒背景の確認用です。</p>
    {/if}
  {/if}

  {#if hasMore}
    <button type="button" class="more" onclick={onLoadMore} disabled={loadingMore}>
      {loadingMore ? '読み込み中…' : 'さらに読み込む'}
    </button>
  {/if}
</section>

<style>
  .jobs {
    display: grid;
    gap: 0.6rem;
    min-width: 0;
    container: job-list / inline-size;
  }

  .jobs-head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 1rem;
  }

  .list {
    margin: 0;
    padding: 0;
    border-bottom: 1px solid var(--rule);
  }

  .empty {
    margin: 0;
    color: var(--muted);
    font-size: 0.875rem;
  }

  .error {
    margin: 0;
    color: var(--danger);
    font-size: 0.875rem;
  }

  .more {
    justify-self: start;
  }
</style>
