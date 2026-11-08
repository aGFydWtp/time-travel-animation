// Unit tests run in plain Node without voidPlugin (it boots the Worker runtime).
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'tests/unit/**/*.test.ts'],
    exclude: ['node_modules/**', 'tests/e2e/**', '.void/**', 'dist/**'],
    passWithNoTests: true,
  },
});
