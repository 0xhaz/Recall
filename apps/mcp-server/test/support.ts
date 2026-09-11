// Shared e2e harness: a real Nest app on a random port over the real Postgres (needs `pnpm db:up`).
// Each test file creates its own throwaway households and removes them afterwards.
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DEFAULT_CAREGIVER_GRANTS, type MembershipRole } from '@recall/core';
import pg from 'pg';
import { AppModule, type AppOverrides } from '../src/app.module.js';
import { hashToken, newToken } from '../src/auth/tokens.js';
import { loadConfig } from '../src/config.js';
import { loadDotEnv } from '../src/env.js';
import { JobWorker } from '../src/jobs/job-worker.js';
import { testDatabaseUrl } from './database.js';
import { TopicEmbedder } from './fakes.js';

export interface TestHousehold {
  id: string;
  token: string;
  people: Record<string, { id: string; email: string }>;
}

export interface TestApp {
  app: INestApplication;
  db: pg.Client;
  baseUrl: string;
  createHousehold(members: [name: string, role: MembershipRole][]): Promise<TestHousehold>;
  mcp(token: string): Promise<Client>;
  /** Run queued jobs now (the background worker is off in tests). */
  drain(): Promise<number>;
  close(): Promise<void>;
}

export function personId(household: TestHousehold, name: string): string {
  const person = household.people[name];
  if (!person) throw new Error(`No ${name} in test household`);
  return person.id;
}

export async function callTool<T>(client: Client, name: string, args: Record<string, unknown>): Promise<T> {
  const result = await client.callTool({ name, arguments: args });
  const text = (result.content as { text?: string }[])[0]?.text;
  if (result.isError || !text) throw new Error(`${name} failed: ${text}`);
  return JSON.parse(text) as T;
}

export async function startApp(overrides: AppOverrides = {}): Promise<TestApp> {
  loadDotEnv();
  // The test database is created and migrated once by global-setup.ts.
  const config = { ...loadConfig(), databaseUrl: testDatabaseUrl(), extractionWorker: false };

  const db = new pg.Client({ connectionString: config.databaseUrl });
  await db.connect();
  // Deterministic embeddings by default, so no test depends on a running model.
  const app = await NestFactory.create(AppModule.register(config, { embedder: new TopicEmbedder(), ...overrides }), {
    logger: false,
  });
  await app.listen(0, '127.0.0.1');
  const baseUrl = await app.getUrl();

  const householdIds: string[] = [];
  const personIds: string[] = [];
  const clients: Client[] = [];

  async function createHousehold(members: [string, MembershipRole][]): Promise<TestHousehold> {
    const id = randomUUID();
    householdIds.push(id);
    await db.query(`INSERT INTO household (id, name, region, timezone) VALUES ($1, $2, 'my', 'Asia/Kuala_Lumpur')`, [
      id,
      `Test ${id.slice(0, 8)}`,
    ]);
    const people: TestHousehold['people'] = {};
    for (const [name, role] of members) {
      const pid = randomUUID();
      personIds.push(pid);
      const email = `${name.toLowerCase()}-${pid.slice(0, 8)}@test.local`;
      await db.query('INSERT INTO person (id, display_name, email) VALUES ($1, $2, $3)', [pid, name, email]);
      await db.query('INSERT INTO membership (household_id, person_id, role, grants) VALUES ($1, $2, $3, $4)', [
        id,
        pid,
        role,
        role === 'caregiver' ? [...DEFAULT_CAREGIVER_GRANTS] : [],
      ]);
      people[name] = { id: pid, email };
    }
    const token = newToken('rcl_hh');
    await db.query(
      `INSERT INTO household_token (household_id, region, token_hash, label) VALUES ($1, 'my', $2, 'test')`,
      [id, hashToken(token)],
    );
    return { id, token, people };
  }

  async function mcp(token: string): Promise<Client> {
    const client = new Client({ name: 'test', version: '0' });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), {
        requestInit: { headers: { Authorization: `Bearer ${token}` } },
      }),
    );
    clients.push(client);
    return client;
  }

  async function close(): Promise<void> {
    await Promise.all(clients.map((c) => c.close()));
    await app.close();
    for (const id of householdIds) {
      for (const table of [
        'session_turn',
        'session',
        'snapshot',
        'context_state',
        'context_baseline',
        'track_affinity',
        'action',
        'care_policy',
        'event',
        'device',
        'rule',
        'notice',
        'routine',
        'activity',
        'fact',
        'utterance',
        'job',
        'llm_usage',
        'household_token',
        'audit_log',
        'membership',
      ]) {
        await db.query(`DELETE FROM ${table} WHERE household_id = $1`, [id]);
      }
      await db.query('DELETE FROM household WHERE id = $1', [id]);
    }
    for (const table of ['audit_log', 'login_token', 'console_session']) {
      const column = table === 'audit_log' ? 'actor_id' : 'person_id';
      await db.query(`DELETE FROM ${table} WHERE ${column} = ANY($1)`, [personIds]);
    }
    await db.query('DELETE FROM person WHERE id = ANY($1)', [personIds]);
    await db.end();
  }

  return { app, db, baseUrl, createHousehold, mcp, drain: () => app.get(JobWorker).drain(), close };
}
