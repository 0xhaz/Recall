import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // e2e tests share one Postgres; each file uses its own throwaway household.
    hookTimeout: 30_000,
    testTimeout: 15_000,
  },
});
