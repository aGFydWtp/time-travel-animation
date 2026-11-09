<script lang="ts">
  import type { RenderJob } from '../api/types.ts';
  import { isTransparentBackground } from '../renderer/schema.ts';
  import DownloadLinks from './DownloadLinks.svelte';

  interface Props {
    /** The finished (completed / failed) job started from this page. */
    job: RenderJob;
    /** The editor settings changed since this job was started. */
    stale: boolean;
  }

  let { job, stale }: Props = $props();

  const assets = $derived(job.status === 'completed' && !job.expired ? job.assets : null);
</script>

<div class="result" data-testid="export-result" data-status={job.status}>
  {#if job.status === 'failed'}
    <p class="failed">書き出しに失敗しました：{job.error?.message ?? '原因が分かりませんでした。'}</p>
  {:else}
    <p class="muted">{stale ? '前回の書き出し' : '書き出しが完了しました'}</p>
    {#if assets}
      <DownloadLinks mov={assets.mov} transparent={isTransparentBackground(job.config)} />
    {/if}
  {/if}
</div>

<style>
  .result {
    display: grid;
    gap: 8px;
    justify-items: start;
  }

  p {
    margin: 0;
    font-size: 13px;
  }

  .muted {
    color: var(--muted);
  }

  .failed {
    color: var(--danger);
    overflow-wrap: anywhere;
  }
</style>
