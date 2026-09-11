import pg from 'pg';
import { migrate } from '../src/db/migrate.js';
import { testDatabaseUrl } from './database.js';

/** Create the test database if needed, migrate it, and wipe it — once, before any test file runs. */
export async function setup(): Promise<void> {
  const url = new URL(testDatabaseUrl());
  const name = url.pathname.slice(1);
  // This database gets truncated below, so only ever touch one that is clearly for tests.
  if (!/^[a-z0-9_]+_test$/i.test(name)) throw new Error(`Test database name must end in _test, got "${name}"`);

  const admin = new URL(url);
  admin.pathname = '/postgres';
  const server = new pg.Client({ connectionString: admin.toString() });
  await server.connect();
  try {
    const { rowCount } = await server.query('SELECT 1 FROM pg_database WHERE datname = $1', [name]);
    if (!rowCount) await server.query(`CREATE DATABASE ${name}`);
  } finally {
    await server.end();
  }

  await migrate(url.toString(), () => undefined);

  // Start from a clean slate: leftovers from an aborted run would otherwise be drained by the tests.
  const db = new pg.Client({ connectionString: url.toString() });
  await db.connect();
  try {
    await db.query('TRUNCATE household, person CASCADE');
  } finally {
    await db.end();
  }
}
