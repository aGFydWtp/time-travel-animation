<script lang="ts">
  import { onMount } from 'svelte';
  import '../src/lib/ui/global.css';
  import { api } from '../src/lib/api/client.ts';
  import JobList from '../src/lib/components/JobList.svelte';
  import SiteHeader from '../src/lib/components/SiteHeader.svelte';
  import { hashConfig } from '../src/lib/renderer/schema.ts';
  import { CONNECTION_LOST_MESSAGE, JobTracker } from '../src/lib/ui/job-tracker.svelte.ts';
  import { loadLastConfig } from '../src/lib/ui/last-config.ts';

  const tracker = new JobTracker(api, { mode: 'list' });
  tracker.loading = true;
  // Hash of the editor's last config (from localStorage); null → no 「今の設定」 marker.
  let currentHash: string | null = $state(null);

  onMount(() => {
    void tracker.refresh();
    const config = loadLastConfig();
    if (config) {
      hashConfig(config).then(
        (hash) => (currentHash = hash),
        () => (currentHash = null),
      );
    }
    return () => tracker.dispose();
  });
</script>

<div class="app">
  <SiteHeader current="history" />

  <main>
    {#if tracker.connectionLost}
      <p class="connection" data-testid="connection-lost">{CONNECTION_LOST_MESSAGE}</p>
    {/if}
    <JobList
      jobs={tracker.jobs}
      {currentHash}
      loading={tracker.loading}
      loadingMore={tracker.loadingMore}
      hasMore={tracker.nextCursor !== null}
      error={tracker.error}
      retryingIds={tracker.retryingIds}
      unavailableIds={tracker.unavailableIds}
      onRetry={(job) => tracker.retry(job)}
      onLoadMore={() => tracker.loadMore()}
      onReload={() => tracker.refresh()}
      headingLevel="h1"
    />
  </main>
</div>

<style>
  .connection {
    margin: 0 0 8px;
    font-size: 13px;
    color: var(--muted);
  }
</style>
