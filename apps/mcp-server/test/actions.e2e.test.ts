// Actions end to end: pre-flight against rules and what's on record, offers from routines and
// context with their source, answers that teach the offer, auto-start after two accepts, and undo.
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { temporalStamp } from '@recall/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { localMinute } from '../src/routines/activity.js';
import type { ParsedRule } from '../src/rules/parse.js';
import { ScriptedLlm } from './fakes.js';
import { callTool, personId, startApp, type TestApp, type TestHousehold } from './support.js';

const TZ = 'America/New_York';

interface Preflight {
  action_id: string;
  decision: 'allow' | 'confirm' | 'block';
  blocked_by: { rule_id: string; text: string } | null;
  withheld: { reason: string; message: string } | null;
  confirm: { check: string; message: string }[];
  message: string;
}
interface Offer {
  action_id: string;
  tier: string;
  say: string;
  summary: string;
  source: { type: string; routine_id?: string; context?: string; text: string };
}
interface Proposal {
  offers: Offer[];
  not_offered: { summary: string; reason: string; blocked_by: { text: string } | null }[];
  withheld?: { reason: string };
}
interface Decided {
  action_id?: string;
  status?: string;
  refused?: string;
  undo_until?: string | null;
  message: string;
}

const parses: ParsedRule[] = [];
const llm = new ScriptedLlm(() => parses.shift());
const blockMusic: ParsedRule = {
  effect: 'block',
  intents: ['media.play'],
  topics: [],
  time_from: null,
  time_to: null,
  days: null,
  school_nights: false,
  applies_to: 'household',
  ends: null,
};

let t: TestApp;
let hh: TestHousehold;
let client: Client;
let alice: string;
let orderId: string;
let coffee: string;

const preflight = (args: Record<string, unknown>) => callTool<Preflight>(client, 'action_preflight', args);
const propose = (speaker: string) => callTool<Proposal>(client, 'propose_action', { speaker });
const decide = (speaker: string, action_id: string, decision: 'confirm' | 'dismiss') =>
  callTool<Decided>(client, 'decide_action', { speaker, action_id, decision });
const undo = (speaker: string, action_id?: string) =>
  callTool<Decided>(client, 'undo', { speaker, ...(action_id ? { action_id } : {}) });
const nowMinute = () => localMinute(TZ, new Date()).minute;
/** Move everything so far a day back: yesterday's offers don't hold back today's. */
const yesterday = () =>
  t.db.query(`UPDATE action SET created_at = created_at - interval '1 day' WHERE household_id = $1`, [hh.id]);

async function routine(kind: string, minute: number): Promise<string> {
  const { rows } = await t.db.query<{ id: string }>(
    `INSERT INTO routine (household_id, region, person_id, kind, days, center_minute, spread_minutes, support,
                          confidence, last_seen)
     VALUES ($1, 'us', $2, $3, 'daily', $4, 8, 12, 0.8, now()::date) RETURNING id`,
    [hh.id, alice, kind, minute],
  );
  const id = rows[0]?.id;
  if (!id) throw new Error('routine not inserted');
  return id;
}

beforeAll(async () => {
  t = await startApp({ llm });
  hh = await t.createHousehold([
    ['Alice', 'owner'],
    ['Tom', 'guest'],
  ]);
  alice = personId(hh, 'Alice');
  client = await t.mcp(hh.token);
});

afterAll(() => t?.close());

describe('action_preflight', () => {
  const order = (address: string) => ({
    speaker: 'Alice',
    action: {
      intent: 'order.food',
      summary: `Order dinner from Napoli Pizza to ${address}`,
      details: { venue: 'Napoli Pizza', address, amount: 30 },
    },
  });

  it('checks an order against order history: a new place and address, then a repeat to a different address', async () => {
    const first = await preflight(order('12 Bergen Street'));
    expect(first.decision).toBe('confirm');
    expect(first.confirm.map((c) => c.check)).toEqual(['venue', 'address']);
    const done = await decide('Alice', first.action_id, 'confirm');
    expect(done).toMatchObject({ status: 'executed' });
    expect(Date.parse(done.undo_until ?? '')).toBeGreaterThan(Date.now());
    orderId = first.action_id;

    const second = await preflight(order('500 Market Street, Floor 30'));
    expect(second.confirm.map((c) => c.check)).toEqual(['address', 'duplicate']);
    expect(second.confirm[0]?.message).toContain('Past orders went to 12 Bergen Street');
  });

  it('keeps guests from ordering, and asks who it is for when nobody said', async () => {
    const guest = await preflight({
      speaker: 'Tom',
      action: { intent: 'order.food', summary: 'Order pizza', details: { venue: 'Pizza Place' } },
    });
    expect(guest).toMatchObject({ decision: 'block', withheld: { reason: 'guest' } });
    expect((await decide('Alice', guest.action_id, 'confirm')).refused).toBe('blocked');

    const unknown = await preflight({ action: { intent: 'ride.book', summary: 'Book a ride to KLCC' } });
    expect(unknown.confirm.map((c) => c.check)).toEqual(['speaker']);
  });

  it("won't announce a delivery nobody ordered", async () => {
    const notice = (summary: string) =>
      preflight({ speaker: 'Alice', action: { intent: 'notification', summary, topics: ['delivery'] } });
    expect((await notice('Your couch delivery arrives at 2am')).withheld?.reason).toBe('no_matching_order');
    expect((await notice('Your Napoli Pizza order is arriving')).decision).toBe('allow');
  });
});

describe('propose_action', () => {
  it('offers a routine that is due, with its source, and the answer teaches it', async () => {
    coffee = await routine('coffee_machine.start', nowMinute());
    const first = await propose('Alice');
    expect(first.offers).toEqual([
      expect.objectContaining({
        tier: 'suggest',
        summary: 'Start the coffee machine',
        source: expect.objectContaining({ type: 'routine', routine_id: coffee }),
      }),
    ]);
    expect(first.offers[0]?.say).toContain('Shall I start the coffee machine?');
    expect((await propose('Alice')).offers).toEqual([]); // once per routine per day

    const offer = first.offers[0];
    if (!offer) throw new Error('no offer');
    expect((await decide('Alice', offer.action_id, 'confirm')).status).toBe('executed');
    const { rows: events } = await t.db.query<{ payload: { command: unknown } }>(
      `SELECT payload FROM event WHERE household_id = $1 AND kind = 'action.executed' ORDER BY seq DESC LIMIT 1`,
      [hh.id],
    );
    expect(events[0]?.payload.command).toEqual({ kind: 'coffee_machine.start', payload: {} });
    const { rows } = await t.db.query('SELECT status, accepted FROM routine WHERE id = $1', [coffee]);
    expect(rows[0]).toEqual({ status: 'offered', accepted: 1 });
  });

  it('starts it on its own after two accepts, and undo takes it back once', async () => {
    await yesterday();
    const second = await propose('Alice');
    expect(second.offers[0]?.tier).toBe('suggest');
    await decide('Alice', second.offers[0]?.action_id ?? '', 'confirm');

    await yesterday();
    const third = await propose('Alice');
    expect(third.offers[0]).toMatchObject({
      tier: 'act',
      say: 'Start the coffee machine, as usual. Say “undo” to stop.',
    });

    const undone = await undo('Alice');
    expect(undone).toMatchObject({ status: 'undone', action_id: third.offers[0]?.action_id });
    const { rows } = await t.db.query<{ payload: { command: unknown }; tombstone: boolean }>(
      `SELECT payload, tombstone FROM event WHERE household_id = $1 AND kind = 'action.undone'`,
      [hh.id],
    );
    expect(rows).toEqual([
      { payload: expect.objectContaining({ command: { kind: 'coffee_machine.stop', payload: {} } }), tombstone: true },
    ]);
    expect((await undo('Alice')).refused).toBe('already_undone');

    await t.db.query(`UPDATE action SET undo_until = now() - interval '1 minute' WHERE id = $1`, [orderId]);
    expect((await undo('Alice', orderId)).refused).toBe('window_closed');
  });

  it('offers the next step of a chain, never medication, and nothing a rule forbids', async () => {
    const kettle = await routine('kettle.start', (nowMinute() + 300) % 1440);
    await routine('medication.taken', nowMinute());
    const news = await routine('media.play', nowMinute());
    await t.db.query(`UPDATE routine SET sequence = ARRAY['kettle.start'] WHERE id = $1`, [coffee]);
    await t.db.query(
      `INSERT INTO activity (household_id, region, person_id, kind, local_date, local_minute, at)
       VALUES ($1, 'us', $2, 'coffee_machine.start', $3, $4, now() - interval '5 minutes')`,
      [hh.id, alice, temporalStamp(TZ).local_date, nowMinute()],
    );
    parses.push(blockMusic);
    const rule = await callTool<{ rule: { id: string } }>(client, 'set_rule', {
      speaker: 'Alice',
      text: 'No music before school',
    });

    const proposal = await propose('Alice');
    expect(proposal.offers).toEqual([
      expect.objectContaining({
        summary: 'Start the kettle',
        say: 'Shall I start the kettle next?',
        source: expect.objectContaining({ routine_id: kettle }),
      }),
    ]);
    expect(proposal.not_offered).toEqual([
      expect.objectContaining({
        reason: 'rule',
        blocked_by: expect.objectContaining({ text: 'No music before school' }),
      }),
    ]);
    expect(JSON.stringify(proposal)).not.toContain('medication');

    await callTool(client, 'remove_rule', { speaker: 'Alice', rule_id: rule.rule.id });
    await t.db.query('DELETE FROM routine WHERE id = $1', [news]);
  });

  it('offers music for a live workout, and nothing at all in quiet hours', async () => {
    await callTool(client, 'set_context', { speaker: 'Alice', context: 'workout', on: true });
    const workout = await propose('Alice');
    expect(workout.offers[0]).toMatchObject({
      summary: 'Play Running Mix (mock catalogue)',
      say: 'Looks like a workout. Want Running Mix?',
      source: { type: 'context', context: 'workout' },
    });

    await callTool(client, 'set_context', { speaker: 'Alice', context: 'wind_down', on: true });
    expect(await propose('Alice')).toMatchObject({ offers: [], withheld: { reason: 'quiet_hours' } });
  });
});

describe('dates worth stopping for', () => {
  // Thanksgiving 2026 is a Thursday. Everything here is pinned to real dates so the test does not
  // drift with the clock: `when` decides the date, not today.
  const buy = (summary: string, when: string, details: Record<string, unknown>) =>
    preflight({ speaker: 'Emma', action: { intent: 'purchase', summary, details: { when, ...details } } });

  it('reads the order back on a holiday, instead of placing it', async () => {
    const out = await buy('Order the turkey', '2026-11-26T15:00:00-05:00', {
      items: ['turkey', 'cranberry sauce'],
      venue: 'Whole Foods',
      amount: 48.2,
      currency: 'USD',
    });
    expect(out.decision).toBe('confirm');
    expect(out.confirm.find((c) => c.check === 'date')?.message).toBe(
      'Thanksgiving: read this back before it goes — turkey, cranberry sauce, from Whole Foods, USD 48.20.',
    );
  });

  it('reads it back before a birthday the household told us about', async () => {
    await t.db.query(
      `INSERT INTO fact (household_id, region, scope_type, scope_id, type, content, confidence)
       VALUES ($1, 'us', 'household', $1, 'semantic', 'Sofia''s birthday is March 3', 0.95)`,
      [hh.id],
    );
    const out = await buy("A cake for Sofia's birthday", '2026-02-28T15:00:00-05:00', { items: ['chocolate cake'] });
    expect(out.confirm.find((c) => c.check === 'date')?.message).toBe(
      "Sofia's birthday: read this back before it goes — chocolate cake.",
    );
  });

  it('leaves an ordinary order near a holiday alone', async () => {
    const out = await buy('Order the usual wet food', '2026-11-23T15:00:00-05:00', {
      items: ['wet food'],
      venue: 'Chewy',
      amount: 23.4,
    });
    expect(out.confirm.some((c) => c.check === 'date')).toBe(false);
  });
});
