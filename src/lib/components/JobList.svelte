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
    onRetry,
    onLoad,
    onLoadMore,
    onReload,
  }: Props = $props();
</script>

<section class="jobs" aria-labelledby="jobs-title" aria-busy={loading}>
  <div class="jobs-head">
    <h2 id="jobs-title" class="section-title">書き出し履歴</h2>
    <button type="button" class="ghost small" onclick={onReload} disabled={loading}>一覧を更新</button>
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
        <JobItem {job} {currentHash} retrying={retryingIds.has(job.id)} {onRetry} {onLoad} />
      {/each}
    </ul>
  {/if}

  {#if hasMore}
    <button type="button" class="ghost more" onclick={onLoadMore} disabled={loadingMore}>
      {loadingMore ? '読み込み中…' : 'さらに読み込む'}
    </button>
  {/if}
</section>

<style>
  .jobs {
    display: grid;
    gap: 0.9rem;
    min-width: 0;
  }

  .jobs-head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 1rem;
  }

  .list {
    display: grid;
    gap: 0.75rem;
    margin: 0;
    padding: 0;
  }

  .empty {
    margin: 0;
    color: var(--muted);
    font-size: 0.86rem;
  }

  .error {
    margin: 0;
    color: var(--danger);
    font-size: 0.86rem;
  }

  .more {
    justify-self: center;
  }
</style>
