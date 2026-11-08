// Docker-backed container renderer tests (spec §12.3). Not part of `pnpm test`.
//   pnpm vitest run -c tests/container/vitest.config.ts
// Skipped automatically when Docker is unavailable.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/container/**/*.test.ts'],
    testTimeout: 120_000,
    hookTimeout: 15 * 60_000,
    fileParallelism: false,
  },
});
