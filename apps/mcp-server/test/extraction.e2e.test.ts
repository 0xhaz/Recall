// The extraction pipeline end to end with a scripted LLM and a deterministic embedder:
// screen → queue → extract → normalise → dedupe / supersede → recall.
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Draft } from '../src/extraction/normalise.js';
import { ScriptedLlm, TopicEmbedder } from './fakes.js';
import { callTool, personId, startApp, type TestApp, type TestHousehold } from './support.js';

interface Fact {
  id: string;
  content: string;
  confidence: number;
  why: string;
}

// Replies the scripted model gives, in order. Anything that isn't an extraction reply is sent as-is.
const extractions: unknown[] = [];
const judgements: unknown[] = [];
const llm = new ScriptedLlm((request) => {
  const system = request.messages[0]?.content ?? '';
  if (system.startsWith('Compare')) return judgements.shift() ?? { verdict: 'new', match: null };
  const next = extractions.shift();
  return Array.isArray(next) ? { facts: next } : (next ?? { facts: [] });
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

async function remember(speaker: string, text: string): Promise<{ utterance_id: string; redacted: string[] }> {
  return callTool(client, 'remember', { speaker, text });
}

async function currentFacts(name: string): Promise<{ content: string; confidence: number; ttl: string | null }[]> {
  const { rows } = await t.db.query(
    `SELECT content, confidence, ttl::text AS ttl FROM fact
      WHERE household_id = $1 AND scope_id = $2 AND valid_to IS NULL ORDER BY created_at`,
    [hh.id, personId(hh, name)],
  );
  return rows;
}

/** Errors from jobs that haven't succeeded, so a failed extraction shows its cause in the diff. */
async function jobErrors(): Promise<string[]> {
  const { rows } = await t.db.query<{ last_error: string }>(
    `SELECT last_error FROM job WHERE household_id = $1 AND status <> 'done' AND last_error IS NOT NULL`,
    [hh.id],
  );
  return rows.map((r) => r.last_error);
}

beforeAll(async () => {
  t = await startApp({ llm, embedder: new TopicEmbedder() });
  hh = await t.createHousehold([
    ['Alice', 'owner'],
    ['Bob', 'adult'],
    ['Kid', 'child'],
  ]);
  client = await t.mcp(hh.token);
});

beforeEach(() => {
  extractions.length = 0;
  judgements.length = 0;
});

afterAll(() => t?.close());

describe('extraction pipeline', () => {
  it('screens before storing, answers from the pending statement, then extracts a fact', async () => {
    extractions.push([draft('Alice is vegetarian')]);
    const result = await remember('Alice', "I'm vegetarian now. My card number is 4111 1111 1111 1111.");
    expect(result.redacted).toEqual(['card_number']);

    const { rows } = await t.db.query<{ text: string }>('SELECT text FROM utterance WHERE id = $1', [
      result.utterance_id,
    ]);
    expect(rows[0]?.text).toBe("I'm vegetarian now.");

    const pending = await callTool<{ facts: Fact[] }>(client, 'recall', { speaker: 'Alice', query: 'vegetarian' });
    expect(pending.facts[0]).toMatchObject({ content: "I'm vegetarian now.", why: 'pending_extraction' });

    expect(await t.drain()).toBe(1);

    const done = await callTool<{ facts: Fact[] }>(client, 'recall', { speaker: 'Alice', query: 'vegetarian' });
    expect(done.facts).toEqual([
      expect.objectContaining({ content: 'Alice is vegetarian', why: 'keyword', confidence: 0.9 }),
    ]);

    expect(llm.calls.every((call) => !JSON.stringify(call.messages).includes('4111'))).toBe(true);
    const usage = await t.db.query('SELECT purpose, calls FROM llm_usage WHERE household_id = $1', [hh.id]);
    expect(usage.rows).toEqual([{ purpose: 'extract', calls: 1 }]);
  });

  it('reinforces a restated fact instead of duplicating it', async () => {
    extractions.push([draft('Alice is a vegetarian', { firm: false })]);
    judgements.push({ verdict: 'same', match: 1 });
    await remember('Alice', "Did I mention I'm a vegetarian?");
    await t.drain();
    expect(await jobErrors()).toEqual([]);

    expect(await currentFacts('Alice')).toEqual([{ content: 'Alice is vegetarian', confidence: 0.95, ttl: null }]);
  });

  it('supersedes a fact that changed, keeping the old one closed and linked', async () => {
    extractions.push([draft('Alice is vegan')]);
    judgements.push({ verdict: 'updates', match: 1 });
    await remember('Alice', "I'm vegan now");
    await t.drain();

    expect((await currentFacts('Alice')).map((f) => f.content)).toEqual(['Alice is vegan']);
    const { rows } = await t.db.query<{ closed: boolean; linked: boolean }>(
      `SELECT old.valid_to IS NOT NULL AS closed, old.superseded_by = new.id AS linked
         FROM fact old JOIN fact new ON new.content = 'Alice is vegan' AND new.household_id = old.household_id
        WHERE old.household_id = $1 AND old.content = 'Alice is vegetarian'`,
      [hh.id],
    );
    expect(rows[0]).toEqual({ closed: true, linked: true });
  });

  it('never lets a temporary situation replace a durable fact', async () => {
    extractions.push([draft('Alice is eating fish', { type: 'episodic', ends: 'tomorrow' })]);
    judgements.push({ verdict: 'updates', match: 1 });
    await remember('Alice', "I'm eating fish this week");
    await t.drain();

    const facts = await currentFacts('Alice');
    expect(facts.map((f) => f.content)).toEqual(['Alice is vegan', 'Alice is eating fish']);
    expect(facts[1]?.ttl).not.toBeNull();
  });

  it('shares a fact with the household only when it was said collectively', async () => {
    extractions.push([
      draft('The household prays together at 7pm', { type: 'procedural', scope: 'household' }),
      draft('Alice likes jazz', { scope: 'household', firm: false }),
    ]);
    await remember('Alice', 'Our family prays together at 7pm, and I like jazz');
    await t.drain();

    const bob = await callTool<{ facts: Fact[] }>(client, 'recall', { speaker: 'Bob', query: 'prays jazz', limit: 10 });
    expect(bob.facts.map((f) => f.content)).toContain('The household prays together at 7pm');
    expect(bob.facts.map((f) => f.content)).not.toContain('Alice likes jazz');
  });

  it("keeps a child's facts short-lived and tagged", async () => {
    extractions.push([draft('Kid likes dinosaurs')]);
    await remember('Kid', 'I like dinosaurs');
    await t.drain();

    const { rows } = await t.db.query<{ sensitivity_tag: string; ttl: string | null }>(
      'SELECT sensitivity_tag, ttl::text AS ttl FROM fact WHERE household_id = $1 AND scope_id = $2',
      [hh.id, personId(hh, 'Kid')],
    );
    expect(rows).toEqual([{ sensitivity_tag: 'child', ttl: expect.any(String) }]);
  });

  it('marks a statement failed after three bad replies, and keeps it recallable', async () => {
    extractions.push('not json facts', 'still wrong', 'nope');
    const { utterance_id } = await remember('Bob', 'I collect vintage stamps');
    for (let attempt = 0; attempt < 3; attempt++) {
      await t.db.query(`UPDATE job SET run_after = now() WHERE payload->>'utterance_id' = $1`, [utterance_id]);
      await t.drain();
    }

    const { rows } = await t.db.query<{ status: string }>('SELECT status FROM utterance WHERE id = $1', [utterance_id]);
    expect(rows[0]?.status).toBe('failed');
    const bob = await callTool<{ facts: Fact[] }>(client, 'recall', { speaker: 'Bob', query: 'stamps' });
    expect(bob.facts[0]).toMatchObject({ content: 'I collect vintage stamps', why: 'pending_extraction' });
  });
});
