// The event log end to end: device ingest, device state, sessions and handoff, and devices that
// converge on the server's memory by replaying events or restarting from a snapshot.
import { randomUUID } from 'node:crypto';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { formatHlc, MemoryProjection, type ProjectionState, type SyncEvent } from '@recall/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Draft } from '../src/extraction/normalise.js';
import { MaintenanceService } from '../src/maintenance/maintenance.service.js';
import { ScriptedLlm, TopicEmbedder } from './fakes.js';
import { callTool, startApp, type TestApp, type TestHousehold } from './support.js';

type SyncResponse =
  | { mode: 'replay'; events: SyncEvent[]; next_cursor: number; has_more: boolean }
  | { mode: 'snapshot'; snapshot: ProjectionState; next_cursor: number; has_more: boolean };

interface IngestResponse {
  accepted: number;
  duplicates: number;
  rejected: { event_id: string; reason: string }[];
}

const extractions: unknown[] = [];
const judgements: unknown[] = [];
const llm = new ScriptedLlm((request) => {
  const system = request.messages[0]?.content ?? '';
  if (system.startsWith('Compare')) return judgements.shift() ?? { verdict: 'new', match: null };
  return { facts: extractions.shift() ?? [] };
});

const draft = (content: string): Draft => ({ content, type: 'semantic', scope: 'person', firm: true, ends: null });

let t: TestApp;
let hh: TestHousehold;
let client: Client;
let tick = 0;

/** A device clock stamp, `offsetMs` from now; the counter keeps stamps from one test strictly ordered. */
const stamp = (offsetMs = 0, node = 'kitchen-echo') =>
  formatHlc({ wall: Date.now() + offsetMs, counter: tick++ % 99_999, node });

const event = (kind: string, payload: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) => ({
  event_id: randomUUID(),
  hlc: stamp(),
  kind,
  payload,
  ...extra,
});

const ingest = (device: string, events: unknown[]) =>
  callTool<IngestResponse>(client, 'ingest_events', { device: { id: device }, events });

/** Keep calling sync until caught up, the way a device would. */
async function syncAll(device: string, start = new MemoryProjection(), limit = 200): Promise<MemoryProjection> {
  let projection = start;
  for (let page = 0; page < 1000; page++) {
    const res = await callTool<SyncResponse>(client, 'sync', { device, cursor: projection.cursor, limit });
    if (res.mode === 'snapshot') projection = new MemoryProjection(res.snapshot);
    else projection.applyAll(res.events);
    if (!res.has_more) return projection;
  }
  throw new Error('sync did not finish');
}

async function serverFacts(): Promise<string[]> {
  const { rows } = await t.db.query<{ content: string }>(
    'SELECT content FROM fact WHERE household_id = $1 AND valid_to IS NULL',
    [hh.id],
  );
  return rows.map((r) => r.content).sort();
}

const contents = (p: MemoryProjection) =>
  p
    .currentFacts()
    .map((f) => f.content)
    .sort();

async function rememberAndExtract(text: string, facts: Draft[], judgement?: unknown): Promise<void> {
  extractions.push(facts);
  if (judgement) judgements.push(judgement);
  await callTool(client, 'remember', { speaker: 'Alice', text });
  await t.drain();
}

beforeAll(async () => {
  t = await startApp({ llm, embedder: new TopicEmbedder() });
  hh = await t.createHousehold([
    ['Alice', 'owner'],
    ['Bob', 'adult'],
  ]);
  client = await t.mcp(hh.token);
});

afterAll(() => t?.close());

describe('ingest_events', () => {
  it('appends idempotently and rejects what devices may not write', async () => {
    const news = event('media.play', { title: 'Morning news' });
    const first = await ingest('kitchen-echo', [
      news,
      event('fact.created', { fact: { id: 'x', content: 'Alice owes Bob money' } }),
      { ...event('timer.start'), hlc: 'yesterday' },
      { ...event('timer.start'), hlc: stamp(10 * 60_000) },
    ]);
    expect(first.accepted).toBe(1);
    expect(first.rejected.map((r) => r.reason)).toEqual([
      'kind "fact.created" is reserved: memory changes go through the tools',
      'hlc must be <13-digit ms>-<5-digit counter>-<node>',
      'hlc is more than 5 minutes ahead of the server clock',
    ]);

    const again = await ingest('kitchen-echo', [news]);
    expect(again).toMatchObject({ accepted: 0, duplicates: 1 });
  });

  it('projects device state, and a late report never overrides a newer one', async () => {
    const [s1, s2, s3] = [stamp(), stamp(), stamp()];
    await ingest('kitchen-echo', [
      { ...event('timer.start', { timer_id: 'pasta', duration_s: 600, label: 'pasta' }), hlc: s1 },
      { ...event('notification.subscribe', { topic: 'deliveries' }), hlc: s1 },
      { ...event('notification.unsubscribe', { topic: 'deliveries' }), hlc: s3 },
    ]);
    await ingest('kitchen-echo', [{ ...event('notification.subscribe', { topic: 'deliveries' }), hlc: s2 }]);

    const { devices } = await callTool<{
      devices: {
        device_id: string;
        state: { now_playing: { title: string }; timers: { label: string; remaining_s: number }[]; notifications: [] };
      }[];
    }>(client, 'device_state', { device: 'kitchen-echo' });
    const kitchen = devices[0];
    expect(kitchen?.state.now_playing.title).toBe('Morning news');
    expect(kitchen?.state.timers).toEqual([expect.objectContaining({ label: 'pasta' })]);
    expect(kitchen?.state.timers[0]?.remaining_s).toBeGreaterThan(590);
    expect(kitchen?.state.notifications).toEqual([]);
  });
});

describe('sessions', () => {
  it('returns the actual turn log, and hands the conversation to another device', async () => {
    const sessionId = randomUUID();
    await ingest('kitchen-echo', [
      event('session.turn', { session_id: sessionId, role: 'user', text: 'What time is it?' }, { person: 'Alice' }),
      event('session.turn', { session_id: sessionId, role: 'assistant', text: 'It is 7:02.' }),
    ]);

    const history = await callTool<{ session: { active: boolean; turns: { role: string; text: string }[] } }>(
      client,
      'session_history',
      { device: 'kitchen-echo' },
    );
    expect(history.session.active).toBe(true);
    expect(history.session.turns.map((turn) => `${turn.role}: ${turn.text}`)).toEqual([
      'user: What time is it?',
      'assistant: It is 7:02.',
    ]);

    const aliceUpstairs = await callTool<{ active_session: { handoff: boolean; recent_turns: unknown[] } }>(
      client,
      'session_brief',
      { speaker: 'Alice', device: 'bedroom-echo' },
    );
    expect(aliceUpstairs.active_session).toMatchObject({ handoff: true, recent_turns: expect.any(Array) });
    expect(aliceUpstairs.active_session.recent_turns).toHaveLength(2);

    const bobUpstairs = await callTool<{ active_session?: unknown }>(client, 'session_brief', {
      speaker: 'Bob',
      device: 'bedroom-echo',
    });
    expect(bobUpstairs.active_session).toBeUndefined();

    const nothing = await callTool<{ session: null; message: string }>(client, 'session_history', { device: 'garage' });
    expect(nothing.session).toBeNull();
    expect(nothing.message).toContain('No conversation on record');
  });
});

describe('sync', () => {
  it("brings every device to the server's memory, however it pages", async () => {
    await rememberAndExtract('I am vegetarian', [draft('Alice is vegetarian')]);
    await rememberAndExtract('Did I say I am a vegetarian?', [draft('Alice is a vegetarian')], {
      verdict: 'same',
      match: 1,
    });
    await rememberAndExtract("I'm vegan now", [draft('Alice is vegan')], { verdict: 'updates', match: 1 });
    await rememberAndExtract('I like jazz', [draft('Alice likes jazz')]);
    await ingest('alice-watch', [event('hr.sample', { bpm: 152 }, { hlc: stamp(0, 'alice-watch') })]);

    const expected = await serverFacts();
    expect(expected).toEqual(['Alice is vegan', 'Alice likes jazz']);

    const kitchen = await syncAll('kitchen-echo');
    const bedroom = await syncAll('bedroom-echo', new MemoryProjection(), 1);
    expect(contents(kitchen)).toEqual(expected);
    expect(bedroom.snapshot()).toEqual(kitchen.snapshot());

    // Raw heart rate never leaves the server, and the log never carries what was said.
    const { events } = await callTool<{ events: SyncEvent[] }>(client, 'sync', {
      device: 'probe',
      cursor: 0,
      limit: 500,
    });
    expect(events.some((e) => e.kind.startsWith('hr.'))).toBe(false);
    const recorded = events.filter((e) => e.kind === 'utterance.recorded');
    expect(recorded).toHaveLength(4);
    expect(recorded.every((e) => !('text' in e.payload))).toBe(true);
  });

  it('restarts a device from a snapshot once the log it needs has been compacted', async () => {
    const kitchenBefore = await syncAll('kitchen-echo');
    await t.db.query(`UPDATE event SET received_at = now() - interval '30 days' WHERE household_id = $1`, [hh.id]);
    await t.db.query('UPDATE household SET retention_days = 7 WHERE id = $1', [hh.id]);

    const report = await t.app.get(MaintenanceService).maintain(hh.id);
    expect(report.events_compacted).toBeGreaterThan(0);
    const { rows: leftovers } = await t.db.query(`SELECT 1 FROM event WHERE household_id = $1 AND kind LIKE 'hr.%'`, [
      hh.id,
    ]);
    expect(leftovers).toHaveLength(0);

    const first = await callTool<SyncResponse>(client, 'sync', { device: 'new-tablet', cursor: 0 });
    expect(first.mode).toBe('snapshot');
    const tablet = await syncAll('new-tablet');
    expect(contents(tablet)).toEqual(await serverFacts());

    // Life goes on after compaction: both the old device and the new one pick up the next change.
    await rememberAndExtract('I drink kopi every morning', [draft('Alice drinks kopi every morning')]);
    const [tabletAfter, kitchenAfter] = [
      await syncAll('new-tablet', tablet),
      await syncAll('kitchen-echo', kitchenBefore),
    ];
    expect(contents(tabletAfter)).toEqual(await serverFacts());
    expect(contents(kitchenAfter)).toEqual(await serverFacts());
  });
});

describe('latency metrics', () => {
  it('publishes p50/p95 per tool against its budget', async () => {
    const res = await fetch(`${t.baseUrl}/metrics/latency`);
    const { tools } = (await res.json()) as {
      tools: Record<string, { count: number; p95: number; budget_p95: number }>;
    };
    expect(tools.session_brief).toMatchObject({ budget_p95: 400 });
    expect(tools.session_brief?.count).toBeGreaterThan(0);
  });
});
