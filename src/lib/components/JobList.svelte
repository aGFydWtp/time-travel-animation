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
    /** Heading level for 「書き出し履歴」 (h1 when it is the page's subject). */
    headingLevel?: 'h1' | 'h2';
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
    headingLevel = 'h2',
    onLoadMore,
    onReload,
  }: Props = $props();

</script>

<section class="jobs" aria-labelledby="jobs-title" aria-busy={loading}>
  <div class="jobs-head">
    <svelte:element this={headingLevel} id="jobs-title" class="section-title">書き出し履歴</svelte:element>
    <button type="button" class="text" onclick={onReload} disabled={loading}>更新</button>
  </div>

  {#if error}
    <p class="error" role="alert">{error}</p>
  {/if}

  {#if loading && jobs.length === 0}
    <p class="empty">読み込み中…</p>
  {:else if jobs.length === 0 && !error}
    <p class="empty">まだ書き出していません</p>
  {:else}
    <ul class="list" data-testid="job-list">
      {#each jobs as job (job.id)}
        <JobItem
          {job}
          {currentHash}
          retrying={retryingIds.has(job.id)}
          unavailable={unavailableIds.has(job.id)}
          {onRetry}
        />
      {/each}
    </ul>
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
    gap: 8px;
    min-width: 0;
  }

  .jobs-head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 16px;
  }

  .list {
    display: grid;
    gap: 8px;
    margin: 0;
    padding: 0;
  }

  .empty {
    margin: 0;
    color: var(--muted);
    font-size: 13px;
  }

  .error {
    margin: 0;
    color: var(--danger);
    font-size: 13px;
  }

  .more {
    justify-self: start;
    margin-top: 8px;
  }
</style>
