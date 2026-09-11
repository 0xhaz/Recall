import { loadDotEnv } from '../src/env.js';

/**
 * Tests get their own database (default: DATABASE_URL with a `_test` suffix), so a dev server
 * running against the main one can't claim test jobs or see test households.
 */
export function testDatabaseUrl(): string {
  loadDotEnv();
  if (process.env.TEST_DATABASE_URL) return process.env.TEST_DATABASE_URL;
  const base = process.env.DATABASE_URL;
  if (!base) throw new Error('DATABASE_URL or TEST_DATABASE_URL is required for tests');
  const url = new URL(base);
  url.pathname = `${url.pathname.replace(/^\//, '')}_test`;
  return url.toString();
}
