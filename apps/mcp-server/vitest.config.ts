import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // One test database (see test/database.ts), wiped once per run by the global setup.
    globalSetup: ['./test/global-setup.ts'],
    // Files run one at a time: the job worker drains the whole queue, so a parallel file's jobs
    // would be claimed (and its scripted LLM replies consumed) by another file's drain().
    fileParallelism: false,
    hookTimeout: 30_000,
    testTimeout: 15_000,
  },
});
