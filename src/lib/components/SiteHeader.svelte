<script lang="ts">
  import { Link } from '@void/svelte';

  interface Props {
    current: 'editor' | 'history';
  }

  let { current }: Props = $props();
</script>

<header class="site-header">
  <nav aria-label="ページ">
    {#if current === 'editor'}
      <h1 class="brand"><Link href="/" aria-current="page">日付アニメーション</Link></h1>
    {:else}
      <p class="brand"><Link href="/">日付アニメーション</Link></p>
    {/if}
    <Link href="/history" class="nav-link" aria-current={current === 'history' ? 'page' : undefined}>書き出し履歴</Link>
  </nav>
</header>

<style>
  .site-header {
    margin-bottom: 24px;
  }

  nav {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 4px 24px;
  }

  .brand {
    margin: 0;
    font-size: 18px;
    font-weight: 600;
  }

  nav :global(a) {
    color: var(--muted);
    text-decoration: none;
  }

  nav :global(a:hover) {
    color: var(--ink);
    text-decoration: underline;
  }

  .brand :global(a) {
    color: var(--ink);
  }

  nav :global(.nav-link) {
    font-size: 15px;
  }

  nav :global(.nav-link[aria-current='page']) {
    color: var(--ink);
    font-weight: 600;
  }

  @media (max-width: 767px) {
    nav :global(.nav-link) {
      padding: 10px 4px;
    }
  }
</style>
