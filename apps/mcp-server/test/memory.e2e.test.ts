// The MCP tools as an assistant sees them: scoping, speaker confidence, remember → pending recall.
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { callTool, personId, startApp, type TestApp, type TestHousehold } from './support.js';

interface Fact {
  content: string;
  scope: string;
  why: string;
}

let t: TestApp;
let hh: TestHousehold;
let client: Client;

beforeAll(async () => {
  t = await startApp();
  hh = await t.createHousehold([
    ['Alice', 'owner'],
    ['Bob', 'adult'],
    ['Gus', 'guest'],
  ]);
  await t.db.query(
    `INSERT INTO fact (household_id, region, scope_type, scope_id, type, content, confidence) VALUES
       ($1, 'my', 'person', $2, 'semantic', 'Alice is vegetarian', 0.95),
       ($1, 'my', 'household', $1, 'semantic', 'Pizza night is on Fridays', 0.8)`,
    [hh.id, personId(hh, 'Alice')],
  );
  client = await t.mcp(hh.token);
});

afterAll(() => t?.close());

describe('tools', () => {
  it('exposes the memory and device tools', async () => {
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name).sort()).toEqual([
      'device_state',
      'ingest_events',
      'recall',
      'remember',
      'session_brief',
      'session_history',
      'sync',
    ]);
  });
});

describe('session_brief', () => {
  it("returns the speaker's own facts plus household facts, with a local temporal stamp", async () => {
    const brief = await callTool<{ temporal: { timezone: string }; ask_who_is_speaking: boolean; facts: Fact[] }>(
      client,
      'session_brief',
      { speaker: 'alice', hint: 'what should we cook tonight?' },
    );
    expect(brief.temporal.timezone).toBe('Asia/Kuala_Lumpur');
    expect(brief.ask_who_is_speaking).toBe(false);
    expect(brief.facts.map((f) => f.content).sort()).toEqual(['Alice is vegetarian', 'Pizza night is on Fridays']);
  });

  it("never shows one person's facts to another", async () => {
    const brief = await callTool<{ facts: Fact[] }>(client, 'session_brief', { speaker: 'Bob' });
    expect(brief.facts.map((f) => f.content)).toEqual(['Pizza night is on Fridays']);
  });

  it('falls back to household facts and asks when the speaker is unknown', async () => {
    const brief = await callTool<{ speaker: unknown; ask_who_is_speaking: boolean; facts: Fact[] }>(
      client,
      'session_brief',
      { speaker: 'Zed' },
    );
    expect(brief.speaker).toBeNull();
    expect(brief.ask_who_is_speaking).toBe(true);
    expect(brief.facts.every((f) => f.scope === 'household')).toBe(true);
  });

  it('treats a low-confidence voice match as unknown but names the candidate to confirm', async () => {
    const brief = await callTool<{ speaker: unknown; speaker_candidate: string; facts: Fact[] }>(
      client,
      'session_brief',
      { speaker: 'Alice', speaker_confidence: 0.4 },
    );
    expect(brief.speaker).toBeNull();
    expect(brief.speaker_candidate).toBe('Alice');
    expect(brief.facts.every((f) => f.scope === 'household')).toBe(true);
  });
});

describe('remember + recall', () => {
  it('makes a new statement recallable by its owner at once, and by nobody else', async () => {
    const stored = await callTool<{ stored: boolean; scope: string; extraction: string }>(client, 'remember', {
      speaker: 'Bob',
      text: 'I am cutting down on rice this month',
    });
    expect(stored).toMatchObject({ stored: true, scope: 'person', extraction: 'queued' });

    const bob = await callTool<{ facts: Fact[] }>(client, 'recall', { speaker: 'Bob', query: 'rice' });
    expect(bob.facts[0]).toMatchObject({ content: 'I am cutting down on rice this month', why: 'pending_extraction' });

    const alice = await callTool<{ facts: Fact[] }>(client, 'recall', { speaker: 'Alice', query: 'rice' });
    expect(alice.facts.some((f) => f.content.includes('rice'))).toBe(false);
  });

  it('refuses to store blocked content and says why', async () => {
    const result = await callTool<{ stored: boolean; reason: string; message: string }>(client, 'remember', {
      speaker: 'Alice',
      text: 'My password is hunter2',
    });
    expect(result).toMatchObject({ stored: false, reason: 'blocked_content', redacted: ['credential'] });
    expect(result.message).toContain('passwords');
    const { rows } = await t.db.query(`SELECT 1 FROM utterance WHERE text LIKE '%hunter2%'`);
    expect(rows).toHaveLength(0);
  });

  it('does not store anything for guests', async () => {
    const result = await callTool<{ stored: boolean; reason: string }>(client, 'remember', {
      speaker: 'Gus',
      text: 'I like jazz',
    });
    expect(result).toMatchObject({ stored: false, reason: 'guest_mode' });
  });

  it('refuses to store personal memory for an unknown speaker', async () => {
    const result = await callTool<{ stored: boolean; reason: string }>(client, 'remember', { text: 'I like jazz' });
    expect(result).toMatchObject({ stored: false, reason: 'unknown_speaker' });
  });
});
