<script lang="ts">
  import type { RenderAssetInfo } from '../api/types.ts';
  import { formatBytes } from '../ui/format.ts';

  interface Props {
    mov: RenderAssetInfo;
    mp4: RenderAssetInfo;
  }

  let { mov, mp4 }: Props = $props();
</script>

{#snippet icon()}
  <svg class="icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2v8M4.5 6.5 8 10l3.5-3.5M3 13.5h10" /></svg>
{/snippet}

<a class="dl primary" href={mov.downloadUrl} download data-testid="download-mov">
  {@render icon()}透過MOVをダウンロード <span class="size">{formatBytes(mov.bytes)}</span>
</a>
<a class="dl" href={mp4.downloadUrl} download data-testid="download-mp4">
  {@render icon()}確認用MP4をダウンロード <span class="size">{formatBytes(mp4.bytes)}</span>
</a>

<style>
  .dl {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    min-height: 32px;
    color: var(--ink);
    text-decoration: none;
    white-space: nowrap;
  }

  .dl:hover {
    text-decoration: underline;
  }

  .primary {
    font-weight: 600;
  }

  .size {
    color: var(--muted);
    font-weight: 400;
  }

  .icon {
    flex: none;
    width: 14px;
    height: 14px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.6;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
</style>
