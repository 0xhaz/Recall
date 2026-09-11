// End-to-end over real Streamable HTTP + Postgres. Needs `pnpm db:up`.
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { loadConfig } from '../src/config.js';
import { migrate } from '../src/db/migrate.js';
import { loadDotEnv } from '../src/env.js';

loadDotEnv();

const TOKEN = 'test-token';
const householdId = randomUUID();
const people = { alice: randomUUID(), bob: randomUUID(), gus: randomUUID() };

let app: INestApplication;
let db: pg.Client;
let mcpUrl: URL;
let client: Client;

interface Fact {
  content: string;
  scope: string;
  why: string;
}

async function call<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const result = await client.callTool({ name, arguments: args });
  const text = (result.content as Array<{ text?: string }>)[0]?.text;
  if (result.isError || !text) throw new Error(`${name} failed: ${text}`);
  return JSON.parse(text) as T;
}

beforeAll(async () => {
  const config = loadConfig();
  await migrate(config.databaseUrl, () => undefined);

  db = new pg.Client({ connectionString: config.databaseUrl });
  await db.connect();
  await db.query(
    `INSERT INTO household (id, name, region, timezone) VALUES ($1, 'Test household', 'my', 'Asia/Kuala_Lumpur')`,
    [householdId],
  );
  for (const [id, name, role] of [
    [people.alice, 'Alice', 'owner'],
    [people.bob, 'Bob', 'adult'],
    [people.gus, 'Gus', 'guest'],
  ] as const) {
    await db.query('INSERT INTO person (id, display_name) VALUES ($1, $2)', [id, name]);
    await db.query('INSERT INTO membership (household_id, person_id, role) VALUES ($1, $2, $3)', [
      householdId,
      id,
      role,
    ]);
  }
  await db.query(
    `INSERT INTO fact (household_id, region, scope_type, scope_id, type, content, confidence) VALUES
       ($1, 'my', 'person', $2, 'semantic', 'Alice is vegetarian', 0.95),
       ($1, 'my', 'household', $1, 'semantic', 'Pizza night is on Fridays', 0.8)`,
    [householdId, people.alice],
  );

  app = await NestFactory.create(AppModule.register({ ...config, devToken: TOKEN, devHouseholdId: householdId }), {
    logger: false,
  });
  await app.listen(0, '127.0.0.1');
  mcpUrl = new URL(`${await app.getUrl()}/mcp`);

  client = new Client({ name: 'e2e', version: '0' });
  await client.connect(
    new StreamableHTTPClientTransport(mcpUrl, { requestInit: { headers: { Authorization: `Bearer ${TOKEN}` } } }),
  );
});

afterAll(async () => {
  await client?.close();
  await app?.close();
  if (db) {
    await db.query('DELETE FROM fact WHERE household_id = $1', [householdId]);
    await db.query('DELETE FROM membership WHERE household_id = $1', [householdId]);
    await db.query('DELETE FROM person WHERE id = ANY($1)', [Object.values(people)]);
    await db.query('DELETE FROM household WHERE id = $1', [householdId]);
    await db.end();
  }
});

describe('MCP endpoint', () => {
  it('rejects requests without the bearer token', async () => {
    const res = await fetch(mcpUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });
    expect(res.status).toBe(401);
  });

  it('exposes the week-1 tools', async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(['recall', 'remember', 'session_brief']);
  });
});

describe('session_brief', () => {
  it("returns the speaker's own facts plus household facts, with a local temporal stamp", async () => {
    const brief = await call<{ temporal: { timezone: string }; ask_who_is_speaking: boolean; facts: Fact[] }>(
      'session_brief',
      { speaker: 'alice', hint: 'what should we cook tonight?' },
    );
    expect(brief.temporal.timezone).toBe('Asia/Kuala_Lumpur');
    expect(brief.ask_who_is_speaking).toBe(false);
    expect(brief.facts.map((f) => f.content).sort()).toEqual(['Alice is vegetarian', 'Pizza night is on Fridays']);
  });

  it("never shows one person's facts to another", async () => {
    const brief = await call<{ facts: Fact[] }>('session_brief', { speaker: 'Bob' });
    expect(brief.facts.map((f) => f.content)).toEqual(['Pizza night is on Fridays']);
  });

  it('falls back to household facts and asks when the speaker is unknown', async () => {
    const brief = await call<{ speaker: unknown; ask_who_is_speaking: boolean; facts: Fact[] }>('session_brief', {
      speaker: 'Zed',
    });
    expect(brief.speaker).toBeNull();
    expect(brief.ask_who_is_speaking).toBe(true);
    expect(brief.facts.every((f) => f.scope === 'household')).toBe(true);
  });
});

describe('remember + recall', () => {
  it('stores person-scoped memory that only its owner can recall', async () => {
    const stored = await call<{ stored: boolean; scope: string }>('remember', {
      speaker: 'Bob',
      text: 'I am cutting down on rice this month',
    });
    expect(stored).toMatchObject({ stored: true, scope: 'person' });

    const bob = await call<{ facts: Fact[] }>('recall', { speaker: 'Bob', query: 'rice' });
    expect(bob.facts[0]).toMatchObject({ content: 'I am cutting down on rice this month', why: 'keyword' });

    const alice = await call<{ facts: Fact[] }>('recall', { speaker: 'Alice', query: 'rice' });
    expect(alice.facts.some((f) => f.content.includes('rice'))).toBe(false);
  });

  it('does not store anything for guests', async () => {
    const result = await call<{ stored: boolean; reason: string }>('remember', { speaker: 'Gus', text: 'I like jazz' });
    expect(result).toMatchObject({ stored: false, reason: 'guest_mode' });
  });

  it('refuses to store personal memory for an unknown speaker', async () => {
    const result = await call<{ stored: boolean; reason: string }>('remember', { text: 'I like jazz' });
    expect(result).toMatchObject({ stored: false, reason: 'unknown_speaker' });
  });
});
