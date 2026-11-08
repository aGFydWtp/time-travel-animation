<script lang="ts">
  import type { Props } from './index.server.ts';

  let { title }: Props = $props();
</script>

<main>
  <h1>{title}</h1>
</main>
