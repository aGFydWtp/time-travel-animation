<script lang="ts">
  import type { RenderAssetInfo } from '../api/types.ts';
  import { formatBytes } from '../ui/format.ts';

  interface Props {
    mov: RenderAssetInfo;
    /** Transparent background → alpha MOV; otherwise an opaque MOV over the chosen colour. */
    transparent: boolean;
  }

  // Only the MOV is downloadable; the MP4 is for in-app playback (再生して確認).
  let { mov, transparent }: Props = $props();
</script>

<a class="btn-outline" href={mov.downloadUrl} download data-testid="download-mov">
  <svg class="icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2v8M4.5 6.5 8 10l3.5-3.5M3 13.5h10" /></svg>{transparent ? '透過MOVをダウンロード' : 'MOVをダウンロード'} <span class="size">{formatBytes(mov.bytes)}</span>
</a>

<style>
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
