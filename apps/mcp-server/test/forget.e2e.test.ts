// Forgetting end to end: topic and id, confirmation when unclear, erasure everywhere the words
// were kept, propagation to devices, stale statements, permissions, "forget me" and the purge.
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { formatHlc, MemoryProjection, type ProjectionState, type SyncEvent } from '@recall/core';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type ConsoleEmailSender, EMAIL_SENDER } from '../src/auth/email.js';
import type { Draft } from '../src/extraction/normalise.js';
import { MaintenanceService } from '../src/maintenance/maintenance.service.js';
import { ScriptedLlm } from './fakes.js';
import { callTool, personId, startApp, type TestApp, type TestHousehold } from './support.js';

type SyncResponse =
  | { mode: 'replay'; events: SyncEvent[]; next_cursor: number; has_more: boolean }
  | { mode: 'snapshot'; snapshot: ProjectionState; next_cursor: number; has_more: boolean };

interface Fact {
  id: string;
  content: string;
  why: string;
}

interface ForgetResponse {
  forgotten: { id: string; content: string }[];
  needs_confirmation?: { id: string; content: string; kind: string }[];
  refused?: string;
  message: string;
}

const extractions: unknown[] = [];
const judgements: unknown[] = [];
const llm = new ScriptedLlm((request) => {
  const system = request.messages[0]?.content ?? '';
  if (system.startsWith('Compare')) return judgements.shift() ?? { verdict: 'new', match: null };
  return { facts: extractions.shift() ?? [] };
});

const draft = (content: string, extra: Partial<Draft> = {}): Draft => ({
  content,
  type: 'semantic',
  scope: 'person',
  firm: true,
  ends: null,
  ...extra,
});

let t: TestApp;
let hh: TestHousehold;
let client: Client;

async function tell(speaker: string, text: string, facts: Draft[], judgement?: unknown): Promise<void> {
  extractions.push(facts);
  if (judgement) judgements.push(judgement);
  await callTool(client, 'remember', { speaker, text });
  await t.drain();
}

const forget = (args: Record<string, unknown>) => callTool<ForgetResponse>(client, 'forget', args);

/** Recall results that actually match, without the filler of recent facts. */
async function matches(speaker: string, query: string): Promise<Fact[]> {
  const { facts } = await callTool<{ facts: Fact[] }>(client, 'recall', { speaker, query, limit: 20 });
  return facts.filter((f) => f.why !== 'recent');
}

async function syncAll(device: string, start = new MemoryProjection()): Promise<MemoryProjection> {
  let projection = start;
  for (let page = 0; page < 100; page++) {
    const res = await callTool<SyncResponse>(client, 'sync', { device, cursor: projection.cursor });
    if (res.mode === 'snapshot') projection = new MemoryProjection(res.snapshot);
    else projection.applyAll(res.events);
    if (!res.has_more) return projection;
  }
  throw new Error('sync did not finish');
}

const contents = (p: MemoryProjection) =>
  p
    .currentFacts()
    .map((f) => f.content)
    .sort();

async function leaks(word: string): Promise<string[]> {
  const { rows } = await t.db.query<{ place: string }>(
    `SELECT 'fact' AS place FROM fact WHERE household_id = $1 AND content ILIKE $2
     UNION ALL SELECT 'utterance' FROM utterance WHERE household_id = $1 AND text ILIKE $2
     UNION ALL SELECT 'event' FROM event WHERE household_id = $1 AND payload::text ILIKE $2
     UNION ALL SELECT 'snapshot' FROM snapshot WHERE household_id = $1 AND data::text ILIKE $2`,
    [hh.id, `%${word}%`],
  );
  return rows.map((r) => r.place);
}

beforeAll(async () => {
  t = await startApp({ llm });
  hh = await t.createHousehold([
    ['Alice', 'owner'],
    ['Bob', 'adult'],
    ['Kid', 'child'],
    ['Gus', 'guest'],
  ]);
  client = await t.mcp(hh.token);
});

beforeEach(() => {
  extractions.length = 0;
  judgements.length = 0;
});

afterAll(() => t?.close());

describe('forget', () => {
  it('forgets a clear match everywhere: the fact, the statement, the log, snapshots and devices', async () => {
    await tell('Alice', "I'm on a diet", [draft('Alice is on a diet')]);
    await tell('Alice', 'I like jazz', [draft('Alice likes jazz')]);
    const kitchen = await syncAll('kitchen-echo');
    expect(contents(kitchen)).toContain('Alice is on a diet');
    await t.app.get(MaintenanceService).snapshot(hh.id);

    const result = await forget({ speaker: 'Alice', topic: 'that I am on a diet' });
    expect(result.forgotten.map((f) => f.content)).toEqual(['Alice is on a diet']);
    expect(await matches('Alice', 'diet')).toEqual([]);
    expect(await leaks('diet')).toEqual([]);

    expect(contents(await syncAll('kitchen-echo', kitchen))).toEqual(['Alice likes jazz']);
    expect(contents(await syncAll('new-tablet'))).toEqual(['Alice likes jazz']);
  });

  it('asks which one when several things match, or the match is only approximate', async () => {
    await tell('Alice', 'I drink coffee at 7, and skip it on Sundays', [
      draft('Alice drinks coffee at 7am'),
      draft('Alice skips coffee on Sundays'),
    ]);
    const ambiguous = await forget({ speaker: 'Alice', topic: 'coffee' });
    expect(ambiguous.forgotten).toEqual([]);
    expect(ambiguous.needs_confirmation?.map((c) => c.content).sort()).toEqual([
      'Alice drinks coffee at 7am',
      'Alice skips coffee on Sundays',
    ]);

    const sundays = ambiguous.needs_confirmation?.find((c) => c.content.includes('Sundays'));
    const chosen = await forget({ speaker: 'Alice', fact_ids: [sundays?.id] });
    expect(chosen.forgotten.map((f) => f.content)).toEqual(['Alice skips coffee on Sundays']);
    expect((await matches('Alice', 'coffee')).map((f) => f.content)).toEqual(['Alice drinks coffee at 7am']);

    await tell('Alice', 'I am vegetarian', [draft('Alice is vegetarian')]);
    const approximate = await forget({ speaker: 'Alice', topic: 'meat' });
    expect(approximate.needs_confirmation?.map((c) => c.content)).toEqual(['Alice is vegetarian']);
    expect((await matches('Alice', 'vegetarian')).map((f) => f.content)).toEqual(['Alice is vegetarian']);
  });

  it('forgets a statement before it is ever extracted', async () => {
    extractions.push([draft('Alice is planning a surprise party for Bob')]);
    await callTool(client, 'remember', { speaker: 'Alice', text: "I'm planning a surprise party for Bob" });

    const result = await forget({ speaker: 'Alice', topic: 'surprise party' });
    expect(result.forgotten.map((f) => f.content)).toEqual(["I'm planning a surprise party for Bob"]);
    await t.drain();
    expect(await matches('Alice', 'surprise')).toEqual([]);
    expect(await leaks('surprise')).toEqual([]);
  });

  it('forgets the history a fact replaced, too', async () => {
    await tell('Bob', 'I live in Ipoh', [draft('Bob lives in Ipoh')]);
    await tell('Bob', 'I moved to Penang', [draft('Bob lives in Penang')], { verdict: 'updates', match: 1 });

    const [penang] = await matches('Bob', 'Penang');
    const result = await forget({ speaker: 'Bob', fact_ids: [penang?.id] });
    expect(result.forgotten.map((f) => f.content)).toEqual(['Bob lives in Penang']);
    expect(await leaks('Ipoh')).toEqual([]);
    expect(await leaks('Penang')).toEqual([]);
  });

  it('keeps an older statement from bringing a forgotten fact back, but not a newer one', async () => {
    await tell('Bob', 'I drink coffee every morning', [draft('Bob drinks coffee every morning')]);
    const saidEarlier = formatHlc({ wall: Date.now() - 60_000, counter: 0, node: 'bob-phone' });
    expect((await forget({ speaker: 'Bob', topic: 'coffee every morning' })).forgotten).toHaveLength(1);

    // An offline phone uploads what Bob said a minute ago, before he asked to forget it.
    extractions.push([draft('Bob drinks coffee every morning')]);
    await callTool(client, 'remember', { speaker: 'Bob', text: 'I drink coffee every morning', said_hlc: saidEarlier });
    await t.drain();
    expect(await matches('Bob', 'coffee')).toEqual([]);

    // Said again after the forget, it counts.
    extractions.push([draft('Bob drinks coffee every morning')]);
    await callTool(client, 'remember', { speaker: 'Bob', text: 'I drink coffee every morning again' });
    await t.drain();
    expect((await matches('Bob', 'coffee')).map((f) => f.content)).toEqual(['Bob drinks coffee every morning']);
  });

  it('only lets the right people forget', async () => {
    await tell('Alice', 'Our family has dinner at 7pm', [
      draft('The household has dinner at 7pm', { scope: 'household', type: 'procedural' }),
    ]);
    const [dinner] = await matches('Alice', 'dinner');
    const [jazz] = await matches('Alice', 'jazz');

    expect((await forget({ speaker: 'Bob', fact_ids: [jazz?.id] })).refused).toBe('not_found');
    expect((await forget({ speaker: 'Kid', fact_ids: [dinner?.id] })).refused).toBe('not_allowed');
    expect((await forget({ speaker: 'Gus', topic: 'dinner' })).refused).toBe('not_allowed');
    expect((await forget({ topic: 'dinner' })).refused).toBe('unknown_speaker');
    expect((await matches('Alice', 'dinner')).map((f) => f.content)).toEqual(['The household has dinner at 7pm']);
  });
});

describe('forget me', () => {
  it("erases a person's memory in every household, revokes their access, and is purged 30 days on", async () => {
    const mail = t.app.get<ConsoleEmailSender>(EMAIL_SENDER);
    const email = hh.people.Alice?.email ?? '';
    const post = (path: string, body: unknown, token?: string) =>
      fetch(`${t.baseUrl}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify(body),
      });

    mail.sent.length = 0;
    await post('/auth/magic-link', { email });
    const link = new URL(mail.sent[0]?.url ?? '');
    const { session_token } = (await (
      await post('/auth/verify', { token: link.searchParams.get('token') })
    ).json()) as {
      session_token: string;
    };

    expect((await post('/me/forget', { confirm: 'yes' }, session_token)).status).toBe(400);
    const res = await post('/me/forget', { confirm: 'forget me' }, session_token);
    expect(res.status).toBe(200);
    const report = (await res.json()) as { facts_forgotten: number; memberships_revoked: number };
    expect(report.memberships_revoked).toBe(1);
    expect(report.facts_forgotten).toBeGreaterThan(0);

    const aliceId = personId(hh, 'Alice');
    const { rows } = await t.db.query(
      `SELECT 1 FROM fact WHERE scope_type = 'person' AND scope_id = $1 AND forgotten_at IS NULL`,
      [aliceId],
    );
    expect(rows).toEqual([]);
    expect(await leaks('jazz')).toEqual([]);

    const brief = await callTool<{ speaker: unknown; facts: Fact[] }>(client, 'session_brief', { speaker: 'Alice' });
    expect(brief.speaker).toBeNull();
    expect(brief.facts.map((f) => f.content)).toContain('The household has dinner at 7pm');
    const me = await fetch(`${t.baseUrl}/me`, { headers: { authorization: `Bearer ${session_token}` } });
    expect(me.status).toBe(401);

    await t.db.query(`UPDATE membership SET revoked_at = now() - interval '31 days' WHERE person_id = $1`, [aliceId]);
    await t.db.query(`UPDATE person SET created_at = now() - interval '60 days' WHERE id = $1`, [aliceId]);
    expect(await t.app.get(MaintenanceService).purgeDeparted()).toBeGreaterThanOrEqual(1);
    const gone = await t.db.query('SELECT 1 FROM person WHERE id = $1', [aliceId]);
    expect(gone.rows).toEqual([]);
  });
});
