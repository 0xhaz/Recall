// Server-side time per read tool stays within its p95 budget (techstack.md §5), measured the way
// /metrics/latency reports it. Uses the deterministic embedder, so this checks Recall's own path
// (SQL, fusion, projections) rather than model speed.
import { randomUUID } from 'node:crypto';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { formatHlc } from '@recall/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LatencyTracker } from '../src/metrics/latency.js';
import { callTool, personId, startApp, type TestApp, type TestHousehold } from './support.js';

const ROUNDS = 30;

let t: TestApp;
let hh: TestHousehold;
let client: Client;

beforeAll(async () => {
  t = await startApp();
  hh = await t.createHousehold([
    ['Alice', 'owner'],
    ['Bob', 'adult'],
  ]);
  client = await t.mcp(hh.token);

  const alice = personId(hh, 'Alice');
  for (let i = 0; i < 40; i++) {
    const [scope, owner] = i % 3 === 0 ? ['household', hh.id] : ['person', alice];
    await t.db.query(
      `INSERT INTO fact (household_id, region, scope_type, scope_id, type, content, confidence)
       VALUES ($1, 'us', $2, $3, 'semantic', $4, 0.8)`,
      [hh.id, scope, owner, `Fact ${i} about dinner, music and the garden`],
    );
  }
  const stamp = (n: number) => formatHlc({ wall: Date.now(), counter: n, node: 'kitchen-echo' });
  const sessionId = randomUUID();
  await callTool(client, 'ingest_events', {
    device: { id: 'kitchen-echo' },
    events: [
      { event_id: randomUUID(), hlc: stamp(1), kind: 'media.play', payload: { title: 'Morning news' } },
      { event_id: randomUUID(), hlc: stamp(2), kind: 'timer.start', payload: { timer_id: 't', duration_s: 600 } },
      {
        event_id: randomUUID(),
        hlc: stamp(3),
        kind: 'session.turn',
        person: 'Alice',
        payload: { session_id: sessionId, role: 'user', text: 'What is for dinner?' },
      },
    ],
  });
  await callTool(client, 'set_rule', {
    speaker: 'Alice',
    text: 'No music after 10pm',
    structured: {
      effect: 'block',
      intents: ['media.play'],
      topics: [],
      time_from: '22:00',
      time_to: '06:00',
      days: null,
      school_nights: false,
      applies_to: 'household',
      ends: null,
    },
  });
});

afterAll(() => t?.close());

describe('latency budgets', () => {
  it('keeps every read tool under its p95 budget', async () => {
    // Warm-up calls aren't what the budget is about; measure from a clean slate after them.
    await callTool(client, 'session_brief', { speaker: 'Alice', device: 'kitchen-echo', hint: 'dinner' });
    await callTool(client, 'recall', { speaker: 'Alice', query: 'music' });
    const tracker = t.app.get(LatencyTracker);
    (tracker as unknown as { samples: Map<string, number[]> }).samples.clear();

    for (let i = 0; i < ROUNDS; i++) {
      await callTool(client, 'session_brief', { speaker: 'Alice', device: 'kitchen-echo', hint: 'what is for dinner' });
      await callTool(client, 'recall', { speaker: 'Alice', query: 'garden music' });
      await callTool(client, 'device_state', { device: 'kitchen-echo' });
      await callTool(client, 'list_rules', { speaker: 'Bob' });
      await callTool(client, 'session_history', { device: 'kitchen-echo' });
    }

    const res = await fetch(`${t.baseUrl}/metrics/latency`);
    const { tools } = (await res.json()) as {
      tools: Record<string, { count: number; p95: number; budget_p95: number | null }>;
    };
    const checked = Object.entries(tools).filter(([, v]) => v.budget_p95 !== null);
    expect(checked.map(([name]) => name).sort()).toEqual([
      'device_state',
      'list_rules',
      'recall',
      'session_brief',
      'session_history',
    ]);
    for (const [name, v] of checked) {
      expect({ tool: name, count: v.count, withinBudget: v.p95 < (v.budget_p95 ?? 0) }).toEqual({
        tool: name,
        count: ROUNDS,
        withinBudget: true,
      });
    }
  });
});
