// Buying the same thing again: what was bought, what is on a cycle, and who is allowed to see it.
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { callTool, personId, startApp, type TestApp, type TestHousehold } from './support.js';

interface Repeat {
  item: string;
  label: string;
  every_days: number;
  confidence: number;
  source: string;
  said: { text: string } | null;
  bought: number;
  last_date: string;
  due_in_days: number;
  due: boolean;
}
interface History {
  recent: { venue: string | null; items: string[] }[];
  repeats: Repeat[];
  due: Repeat[];
}

let t: TestApp;
let hh: TestHousehold;
let client: Client;

/** Days ago, at 10:00 in the household's own timezone, so the local date is never ambiguous. */
const ago = (days: number): Date => new Date(Date.now() - days * 86_400_000 + 4 * 3_600_000);

async function bought(item: string, days: number, opts: { person?: string; venue?: string } = {}): Promise<void> {
  await t.db.query(
    `INSERT INTO action (household_id, region, person_id, intent, summary, details, status, decided_at)
     VALUES ($1, 'us', $2, 'purchase', $3, $4, 'executed', $5)`,
    [
      hh.id,
      opts.person ? personId(hh, opts.person) : null,
      `Order ${item}`,
      JSON.stringify({ venue: opts.venue ?? 'Chewy', amount: 24.5, currency: 'USD', items: [item] }),
      ago(days),
    ],
  );
}

beforeAll(async () => {
  t = await startApp();
  hh = await t.createHousehold([
    ['Alice', 'owner'],
    ['Bob', 'adult'],
  ]);
  // A weekly buy, three shops deep, last one four days ago: due in three.
  for (const d of [4, 11, 18, 25]) await bought('wet food', d);
  // Coffee every fortnight, last bought three weeks ago: a week overdue.
  for (const d of [21, 35, 49]) await bought('coffee beans', d, { venue: 'Blue Bottle' });
  // Something Bob bought for himself. Alice must never see it, not even in a count.
  for (const d of [3, 10, 17]) await bought('protein powder', d, { person: 'Bob' });
  client = await t.mcp(hh.token);
});

afterAll(() => t?.close());

describe('purchase_history', () => {
  it('lists what was bought, newest first', async () => {
    const h = await callTool<History>(client, 'purchase_history', { speaker: 'Alice', limit: 3 });
    expect(h.recent).toHaveLength(3);
    expect(h.recent[0]).toMatchObject({ venue: 'Chewy', items: ['wet food'] });
  });

  it('works out the cycle and when each item is next due', async () => {
    const h = await callTool<History>(client, 'purchase_history', { speaker: 'Alice' });
    const wet = h.repeats.find((r) => r.item === 'wet food');
    expect(wet).toMatchObject({ every_days: 7, bought: 4, source: 'mined', due_in_days: 3, due: false });
    expect(wet?.confidence).toBeGreaterThan(0.7);
    const coffee = h.repeats.find((r) => r.item === 'coffee beans');
    expect(coffee).toMatchObject({ every_days: 14, due_in_days: -7, due: true });
  });

  it('puts only the overdue items in `due`, soonest first', async () => {
    const h = await callTool<History>(client, 'purchase_history', { speaker: 'Alice' });
    expect(h.due.map((r) => r.item)).toEqual(['coffee beans']);
  });

  it('answers about one thing when asked', async () => {
    const h = await callTool<History>(client, 'purchase_history', { speaker: 'Alice', item: 'wet food' });
    expect(h.recent.every((r) => r.items.includes('wet food'))).toBe(true);
    expect(h.repeats.map((r) => r.item)).toEqual(['wet food']);
  });

  it("never shows one person's purchases to another", async () => {
    const alice = await callTool<History>(client, 'purchase_history', { speaker: 'Alice', limit: 25 });
    expect(alice.recent.some((r) => r.items.includes('protein powder'))).toBe(false);
    expect(alice.repeats.some((r) => r.item === 'protein powder')).toBe(false);

    const bob = await callTool<History>(client, 'purchase_history', { speaker: 'Bob', limit: 25 });
    expect(bob.repeats.find((r) => r.item === 'protein powder')).toMatchObject({ every_days: 7, bought: 3 });
  });

  it('shows the household its shared purchases even with no speaker', async () => {
    const h = await callTool<History>(client, 'purchase_history', {});
    expect(h.repeats.map((r) => r.item).sort()).toEqual(['coffee beans', 'wet food']);
  });

  it("takes the person's stated cycle over the arithmetic, and quotes it back", async () => {
    await t.db.query(
      `INSERT INTO fact (household_id, region, scope_type, scope_id, type, content, confidence)
       VALUES ($1, 'us', 'household', $1, 'semantic', 'We buy wet food every fortnight', 0.9)`,
      [hh.id],
    );
    const h = await callTool<History>(client, 'purchase_history', { speaker: 'Alice', item: 'wet food' });
    expect(h.repeats[0]).toMatchObject({
      every_days: 14,
      source: 'stated',
      said: { text: 'We buy wet food every fortnight' },
      due_in_days: 10,
    });
  });
});
