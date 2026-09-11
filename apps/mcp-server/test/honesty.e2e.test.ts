// Honesty tools: explain_memory (including "nothing about your uncle"), verify_claim as evidence,
// search by meaning as well as words, the embedding backfill, and the per-person tone dial.
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Extractor } from '../src/extraction/extractor.js';
import type { Draft } from '../src/extraction/normalise.js';
import { ScriptedLlm } from './fakes.js';
import { callTool, personId, startApp, type TestApp, type TestHousehold } from './support.js';

interface Item {
  content: string;
  source: string;
}

interface Explanation {
  nothing_stored: boolean;
  yours: Item[];
  household: Item[];
  spoken: string;
}

interface Verification {
  status: string;
  evidence: (Item & { why: string })[];
  changed: { content: string; now: string | null }[];
}

const extractions: unknown[] = [];
const llm = new ScriptedLlm(() => ({ facts: extractions.shift() ?? [] }));
const draft = (content: string): Draft => ({ content, type: 'semantic', scope: 'person', firm: true, ends: null });

let t: TestApp;
let hh: TestHousehold;
let client: Client;

beforeAll(async () => {
  t = await startApp({ llm });
  hh = await t.createHousehold([
    ['Alice', 'owner'],
    ['Bob', 'adult'],
  ]);
  client = await t.mcp(hh.token);

  const alice = personId(hh, 'Alice');
  const { rows } = await t.db.query<{ id: string }>(
    `INSERT INTO fact (household_id, region, scope_type, scope_id, type, content, confidence, source) VALUES
       ($1, 'my', 'person', $2, 'semantic', 'Alice lives in Penang', 0.9, '{"origin":"extraction"}')
     RETURNING id`,
    [hh.id, alice],
  );
  await t.db.query(
    `INSERT INTO fact (household_id, region, scope_type, scope_id, type, content, confidence, source, valid_to, superseded_by) VALUES
       ($1, 'my', 'person', $2, 'semantic', 'Alice takes her tea with condensed milk', 0.95, '{"origin":"caregiver"}', NULL, NULL),
       ($1, 'my', 'household', $1, 'procedural', 'Family dinner is at 7.30pm', 0.8, '{"origin":"seed"}', NULL, NULL),
       ($1, 'my', 'person', $2, 'semantic', 'Alice lives in Ipoh', 0.9, '{"origin":"extraction"}', now() - interval '1 day', $3),
       ($1, 'my', 'person', $4, 'semantic', 'Bob eats meat daily', 0.9, '{"origin":"extraction"}', NULL, NULL)`,
    [hh.id, alice, rows[0]?.id, personId(hh, 'Bob')],
  );

  extractions.push([draft('Alice is vegetarian')]);
  await callTool(client, 'remember', { speaker: 'Alice', text: 'I am vegetarian' });
  await t.drain();
});

afterAll(() => t?.close());

describe('explain_memory', () => {
  it('lists what is kept about the speaker and the household, with where each came from', async () => {
    const e = await callTool<Explanation>(client, 'explain_memory', { speaker: 'Alice' });
    expect(e.yours.map((i) => [i.content, i.source])).toEqual(
      expect.arrayContaining([
        ['Alice is vegetarian', 'you told me'],
        ['Alice takes her tea with condensed milk', 'entered by a caregiver'],
      ]),
    );
    expect(e.yours.map((i) => i.content)).not.toContain('Alice lives in Ipoh');
    expect(e.household.map((i) => i.content)).toEqual(['Family dinner is at 7.30pm']);
    expect(e.spoken).toContain('About you:');
    expect(e.spoken).toContain('I never keep card or account numbers');
  });

  it('says so when nothing is stored about the subject', async () => {
    const e = await callTool<Explanation>(client, 'explain_memory', { speaker: 'Alice', about: 'my uncle' });
    expect(e.nothing_stored).toBe(true);
    expect(e.spoken.startsWith("I don't have anything stored about my uncle.")).toBe(true);
  });

  it('shows an unknown speaker only what belongs to the household', async () => {
    const e = await callTool<Explanation>(client, 'explain_memory', {});
    expect(e.yours).toEqual([]);
    expect(e.household.map((i) => i.content)).toEqual(['Family dinner is at 7.30pm']);
  });
});

describe('verify_claim', () => {
  it('returns evidence with its source when something on record matches', async () => {
    const v = await callTool<Verification>(client, 'verify_claim', { speaker: 'Alice', claim: 'Alice is vegetarian' });
    expect(v.status).toBe('evidence');
    expect(v.evidence[0]).toMatchObject({ content: 'Alice is vegetarian', source: 'you told me' });
  });

  it("says unknown instead of letting the speaker's name match everything", async () => {
    const v = await callTool<Verification>(client, 'verify_claim', {
      speaker: 'Alice',
      claim: 'Alice has a brother called Amir',
    });
    expect(v).toMatchObject({ status: 'unknown', evidence: [], changed: [] });
  });

  it('shows what changed, and what is true now', async () => {
    const v = await callTool<Verification>(client, 'verify_claim', { speaker: 'Alice', claim: 'Alice lives in Ipoh' });
    expect(v.status).toBe('evidence');
    expect(v.evidence.map((e) => e.content)).toContain('Alice lives in Penang');
    expect(v.changed).toEqual([
      expect.objectContaining({ content: 'Alice lives in Ipoh', now: 'Alice lives in Penang' }),
    ]);
  });
});

describe('search by meaning', () => {
  it('finds a fact that shares no words with the question', async () => {
    const { facts } = await callTool<{ facts: { content: string; why: string }[] }>(client, 'recall', {
      speaker: 'Alice',
      query: 'meat',
    });
    expect(facts[0]).toMatchObject({ content: 'Alice is vegetarian', why: 'semantic' });
  });

  it('backfills embeddings for facts written without one', async () => {
    const ask = async () =>
      (
        await callTool<{ facts: { content: string; why: string }[] }>(client, 'recall', {
          speaker: 'Bob',
          query: 'vegan',
        })
      ).facts.filter((f) => f.why !== 'recent');
    expect(await ask()).toEqual([]);
    expect(await t.app.get(Extractor).embedMissing(hh.id)).toBeGreaterThan(0);
    expect(await ask()).toEqual([expect.objectContaining({ content: 'Bob eats meat daily', why: 'semantic' })]);
  });
});

describe('communication style', () => {
  it('is terse by default, and follows the person once they change it', async () => {
    const style = async (speaker: string) =>
      (await callTool<{ response_style: Record<string, unknown> }>(client, 'session_brief', { speaker }))
        .response_style;

    expect(await style('Alice')).toMatchObject({
      verbosity: 'brief',
      commentary: false,
      humour: false,
      emotional_language: false,
      rules: expect.arrayContaining([expect.stringContaining('confirm in a word or two')]),
    });

    const set = await callTool<{ style: Record<string, unknown> }>(client, 'set_communication_style', {
      speaker: 'Alice',
      verbosity: 'normal',
      humour: true,
    });
    expect(set.style).toMatchObject({ verbosity: 'normal', humour: true, commentary: false });
    await callTool(client, 'set_communication_style', { speaker: 'Alice', commentary: true });

    expect(await style('Alice')).toMatchObject({ verbosity: 'normal', humour: true, commentary: true });
    expect(await style('Bob')).toMatchObject({ verbosity: 'brief', humour: false });
    const refused = await callTool<{ refused: string }>(client, 'set_communication_style', { humour: true });
    expect(refused.refused).toBe('unknown_speaker');
  });
});
