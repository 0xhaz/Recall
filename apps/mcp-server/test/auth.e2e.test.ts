// Tenancy and sign-in: per-household MCP tokens, isolation, magic links, owner-only token management.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ConsoleEmailSender } from '../src/auth/email.js';
import { EMAIL_SENDER } from '../src/auth/email.js';
import { callTool, personId, startApp, type TestApp, type TestHousehold } from './support.js';

let t: TestApp;
let a: TestHousehold;
let b: TestHousehold;
let mail: ConsoleEmailSender;

function request(method: string, path: string, body?: unknown, token?: string): Promise<Response> {
  return fetch(`${t.baseUrl}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const listTools = { jsonrpc: '2.0', id: 1, method: 'tools/list' };

function email(household: TestHousehold, name: string): string {
  const person = household.people[name];
  if (!person) throw new Error(`No ${name}`);
  return person.email;
}

async function signIn(address: string): Promise<string> {
  mail.sent.length = 0;
  await request('POST', '/auth/magic-link', { email: address });
  const link = mail.sent[0]?.url;
  if (!link) throw new Error(`No magic link sent to ${address}`);
  const res = await request('POST', '/auth/verify', { token: new URL(link).searchParams.get('token') });
  const { session_token } = (await res.json()) as { session_token: string };
  return session_token;
}

beforeAll(async () => {
  t = await startApp();
  mail = t.app.get<ConsoleEmailSender>(EMAIL_SENDER);
  a = await t.createHousehold([
    ['Alice', 'owner'],
    ['Bob', 'adult'],
  ]);
  b = await t.createHousehold([['Carol', 'owner']]);
  await t.db.query(
    `INSERT INTO fact (household_id, region, scope_type, scope_id, type, content, confidence)
     VALUES ($1, 'my', 'person', $2, 'semantic', 'Alice is vegetarian', 0.95)`,
    [a.id, personId(a, 'Alice')],
  );
});

afterAll(() => t?.close());

describe('MCP bearer tokens', () => {
  it('rejects missing and unknown tokens', async () => {
    expect((await request('POST', '/mcp', listTools)).status).toBe(401);
    expect((await request('POST', '/mcp', listTools, 'rcl_hh_not-a-real-token')).status).toBe(401);
  });

  it("keeps each household's memory behind its own token", async () => {
    const other = await t.mcp(b.token);
    for (const speaker of ['Alice', personId(a, 'Alice')]) {
      const res = await callTool<{ speaker_resolved: boolean; facts: { content: string }[] }>(other, 'recall', {
        speaker,
        query: 'vegetarian',
      });
      expect(res.speaker_resolved).toBe(false);
      expect(res.facts).toEqual([]);
    }

    const own = await t.mcp(a.token);
    const res = await callTool<{ facts: { content: string }[] }>(own, 'recall', {
      speaker: 'Alice',
      query: 'vegetarian',
    });
    expect(res.facts.map((f) => f.content)).toEqual(['Alice is vegetarian']);
  });
});

describe('console sign-in', () => {
  it('signs in with a single-use magic link', async () => {
    mail.sent.length = 0;
    const requested = await request('POST', '/auth/magic-link', { email: email(a, 'Alice') });
    expect(requested.status).toBe(202);
    expect(mail.sent).toHaveLength(1);

    const token = new URL(mail.sent[0]?.url ?? '').searchParams.get('token');
    const first = await request('POST', '/auth/verify', { token });
    expect(first.status).toBe(200);
    const { session_token } = (await first.json()) as { session_token: string };
    expect(session_token).toMatch(/^rcl_sess_/);

    expect((await request('POST', '/auth/verify', { token })).status).toBe(401);

    const me = (await (await request('GET', '/me', undefined, session_token)).json()) as {
      display_name: string;
      memberships: { household_id: string; role: string }[];
    };
    expect(me.display_name).toBe('Alice');
    expect(me.memberships).toEqual([expect.objectContaining({ household_id: a.id, role: 'owner' })]);
  });

  it('does not reveal whether an email has an account', async () => {
    mail.sent.length = 0;
    const res = await request('POST', '/auth/magic-link', { email: 'nobody@test.local' });
    expect(res.status).toBe(202);
    expect(mail.sent).toHaveLength(0);
  });

  it('rejects bad input and missing sessions', async () => {
    expect((await request('POST', '/auth/magic-link', { email: 'not-an-email' })).status).toBe(400);
    expect((await request('GET', '/me')).status).toBe(401);
  });
});

describe('household tokens', () => {
  it('lets the owner mint a token that works on /mcp, and revoke it', async () => {
    const session = await signIn(email(a, 'Alice'));
    const created = await request('POST', `/households/${a.id}/tokens`, { label: 'kitchen echo' }, session);
    expect(created.status).toBe(201);
    const { id, token } = (await created.json()) as { id: string; token: string };
    expect(token).toMatch(/^rcl_hh_/);
    expect((await request('POST', '/mcp', listTools, token)).status).toBe(200);

    expect((await request('DELETE', `/households/${a.id}/tokens/${id}`, undefined, session)).status).toBe(204);
    expect((await request('POST', '/mcp', listTools, token)).status).toBe(401);

    const { rows } = await t.db.query<{ action: string }>(
      'SELECT action FROM audit_log WHERE household_id = $1 ORDER BY id',
      [a.id],
    );
    expect(rows.map((r) => r.action)).toEqual(['token.create', 'token.revoke']);
  });

  it('forbids non-owners and owners of other households', async () => {
    const bob = await signIn(email(a, 'Bob'));
    expect((await request('POST', `/households/${a.id}/tokens`, { label: 'x' }, bob)).status).toBe(403);

    const carol = await signIn(email(b, 'Carol'));
    expect((await request('POST', `/households/${a.id}/tokens`, { label: 'x' }, carol)).status).toBe(403);
  });
});
