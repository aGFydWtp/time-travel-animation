<script lang="ts">
  import { Link } from '@void/svelte';

  interface Props {
    current: 'editor' | 'history';
  }

  let { current }: Props = $props();
</script>

<header class="site-header">
  {#if current === 'editor'}
    <h1 class="brand"><Link href="/" aria-current="page">日付アニメーション</Link></h1>
    <Link href="/history" class="icon-link" aria-label="書き出し一覧" title="書き出し一覧">
      <svg viewBox="0 0 20 20" aria-hidden="true">
        <circle cx="4" cy="5" r="1.25" />
        <circle cx="4" cy="10" r="1.25" />
        <circle cx="4" cy="15" r="1.25" />
        <path d="M8 5h9M8 10h9M8 15h9" />
      </svg>
    </Link>
  {:else}
    <p class="brand"><Link href="/">日付アニメーション</Link></p>
  {/if}
</header>

<style>
  .site-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    margin-bottom: 24px;
  }

  .brand {
    margin: 0;
    font-size: 18px;
    font-weight: 600;
  }

  .brand :global(a) {
    color: var(--ink);
    text-decoration: none;
  }

  .brand :global(a:hover) {
    text-decoration: underline;
  }

  .site-header :global(.icon-link) {
    display: grid;
    place-items: center;
    flex: none;
    width: 36px;
    height: 36px;
    border-radius: 6px;
    color: var(--ink);
  }

  .site-header :global(.icon-link:hover) {
    background: var(--hover);
  }

  .site-header :global(.icon-link svg) {
    width: 20px;
    height: 20px;
    fill: currentColor;
    stroke: currentColor;
    stroke-width: 1.6;
    stroke-linecap: round;
  }

  .site-header :global(.icon-link svg circle) {
    stroke: none;
  }
</style>
