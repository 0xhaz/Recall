import { describe, expect, it } from 'vitest';
import {
  describeKind,
  evaluatePreflight,
  initiationWithheld,
  intentForKind,
  inverseCommand,
  offerTier,
  type PastOrder,
  type PreflightInput,
  signedMinutes,
} from './actions.js';
import type { RuleDecision } from './rules.js';

const ALLOW: RuleDecision = {
  decision: 'allow',
  blocked_by: null,
  confirm: [],
  suppress_offer: false,
  prefer: [],
  applied: [],
};
const NOW = new Date('2026-10-05T12:00:00Z');

const base = (over: Partial<PreflightInput> = {}): PreflightInput => ({
  action: { intent: 'order.food', summary: 'Order dinner', topics: [], details: {} },
  proactive: false,
  source: null,
  speaker: { role: 'owner' },
  rules: ALLOW,
  quietHours: { active: false, because: [] },
  knownAddresses: [],
  venueFacts: [],
  orders: [],
  routines: [],
  whenMinute: null,
  now: NOW,
  ...over,
});

const order = (minutesAgo: number, extra: Partial<PastOrder> = {}): PastOrder => ({
  action_id: `o${minutesAgo}`,
  intent: 'order.food',
  venue: 'Napoli Pizza',
  address: '12 Bergen Street',
  amount: 30,
  items: [],
  at: new Date(NOW.getTime() - minutesAgo * 60_000).toISOString(),
  ...extra,
});

const food = (details: PreflightInput['action']['details']) => ({
  action: { intent: 'order.food' as const, summary: 'Order dinner', topics: [], details },
});

describe('kinds', () => {
  it('maps routine kinds to intents, and never offers check-ins, health, sleep or locks', () => {
    expect(intentForKind('coffee_machine.start')).toBe('smart_home');
    expect(intentForKind('media.play')).toBe('media.play');
    expect(intentForKind('timer.start')).toBe('reminder');
    for (const kind of ['checkin.morning', 'medication.taken', 'door.lock', 'sleep.start', 'hr.sample', 'media.skip']) {
      expect(intentForKind(kind)).toBeNull();
    }
  });

  it('describes and reverses device commands, but never unlocks a door as an undo', () => {
    expect(describeKind('coffee_machine.start')).toBe('start the coffee machine');
    expect(describeKind('lights.on')).toBe('turn on the lights');
    expect(describeKind('media.play', 'Evening Calm')).toBe('put on Evening Calm');
    expect(inverseCommand({ kind: 'media.play', payload: { title: 'x' } })?.kind).toBe('media.stop');
    expect(inverseCommand({ kind: 'timer.start', payload: { timer_id: 't1' } })).toEqual({
      kind: 'timer.cancel',
      payload: { timer_id: 't1' },
    });
    expect(inverseCommand({ kind: 'lights.on', payload: {} })?.kind).toBe('lights.off');
    expect(inverseCommand({ kind: 'door.lock', payload: {} })).toBeNull();
  });

  it('measures minutes across midnight', () => {
    expect(signedMinutes(1435, 5)).toBe(-10);
    expect(signedMinutes(430, 410)).toBe(20);
  });
});

describe('proactivity', () => {
  it('never starts health, bereavement or money topics', () => {
    expect(initiationWithheld('Remind you about your blood pressure', ['health'])).toBe('health');
    expect(initiationWithheld('On this day your father passed away')).toBe('bereavement');
    expect(initiationWithheld('Play Running Mix (mock catalogue)')).toBeNull();
    expect(initiationWithheld('Start the coffee machine')).toBeNull();
  });

  it('acts only on low-risk offers accepted twice, and only drafts anything that costs money', () => {
    expect(offerTier('smart_home', { accepted: 2, dismissed: 0, last: 'executed' }, null)).toBe('act');
    expect(offerTier('smart_home', { accepted: 3, dismissed: 1, last: 'dismissed' }, null)).toBe('suggest');
    expect(offerTier('media.play', { accepted: 5, dismissed: 0, last: 'executed' }, 'party')).toBe('suggest');
    expect(offerTier('order.food', { accepted: 9, dismissed: 0, last: 'executed' }, null)).toBe('draft');
  });
});

describe('evaluatePreflight', () => {
  it('quotes the rule that blocks, and turns require_confirm rules into questions', () => {
    const blocked = evaluatePreflight(
      base({ rules: { ...ALLOW, decision: 'block', blocked_by: { rule_id: 'r1', text: 'No takeaway on weekdays' } } }),
    );
    expect(blocked).toMatchObject({ decision: 'block', blocked_by: { text: 'No takeaway on weekdays' }, confirm: [] });
    expect(blocked.message).toBe('Not allowed: “No takeaway on weekdays”.');

    const ask = evaluatePreflight(
      base({
        rules: { ...ALLOW, decision: 'require_confirm', confirm: [{ rule_id: 'r2', text: 'Ask me before any order' }] },
      }),
    );
    expect(ask.decision).toBe('confirm');
    expect(ask.confirm[0]).toMatchObject({ check: 'rule', evidence: { rule_id: 'r2' } });
  });

  it('checks the delivery address against the one on record', () => {
    const knownAddresses = [{ fact_id: 'f1', content: 'Home delivery address is 12 Bergen Street, KL' }];
    const orders = [order(3 * 24 * 60)];
    const home = evaluatePreflight(
      base({ ...food({ venue: 'Napoli Pizza', address: '12 Bergen Street' }), knownAddresses, orders }),
    );
    expect(home.decision).toBe('allow');
    const office = evaluatePreflight(
      base({ ...food({ venue: 'Napoli Pizza', address: 'Menara KL, Level 30' }), knownAddresses, orders }),
    );
    expect(office.confirm).toEqual([expect.objectContaining({ check: 'address', evidence: { fact_id: 'f1' } })]);
  });

  it('knows a venue from memory before its first order through Recall', () => {
    expect(evaluatePreflight(base(food({ venue: 'Napoli Pizza' }))).confirm.map((c) => c.check)).toEqual(['venue']);
    const usual = { fact_id: 'f4', content: "The family's usual weeknight takeaway is Napoli Pizza" };
    expect(evaluatePreflight(base({ ...food({ venue: 'Napoli Pizza' }), venueFacts: [usual] })).decision).toBe('allow');
  });

  it('catches details that disagree with the request itself', () => {
    const swapped = evaluatePreflight(
      base({
        action: {
          intent: 'order.food',
          summary: 'Order dinner from the usual place to the Midtown office, level 30',
          topics: [],
          details: { venue: 'Napoli Pizza', address: '412 Bergen Street, Brooklyn' },
        },
        venueFacts: [{ fact_id: 'f4', content: 'The usual takeaway is Napoli Pizza' }],
        knownAddresses: [{ fact_id: 'f8', content: 'Home delivery address is 412 Bergen Street, Brooklyn' }],
      }),
    );
    expect(swapped.confirm).toEqual([
      {
        check: 'address',
        message:
          'The request says “the Midtown office, level 30”, but this would go to 412 Bergen Street, Brooklyn. Which one?',
      },
    ]);
    const toHome = evaluatePreflight(
      base({
        action: {
          intent: 'order.food',
          summary: 'Order dinner to home',
          topics: [],
          details: { address: '412 Bergen Street' },
        },
        knownAddresses: [{ fact_id: 'f8', content: 'Home delivery address is 412 Bergen Street, Brooklyn' }],
      }),
    );
    expect(toHome.decision).toBe('allow');
  });

  it('asks about a repeat order, an unusual amount, and a ride that clashes with a routine', () => {
    const orders = [order(20), order(3000, { amount: 25 }), order(6000, { amount: 32 })];
    const again = evaluatePreflight(base({ ...food({ venue: 'Napoli Pizza', amount: 90 }), orders }));
    expect(again.confirm.map((c) => c.check)).toEqual(['duplicate', 'amount']);

    const ride = evaluatePreflight(
      base({
        action: { intent: 'ride.book', summary: 'Ride to KLCC', topics: [], details: {} },
        routines: [{ kind: 'coffee_machine.start', minute: 430 }],
        whenMinute: 440,
      }),
    );
    expect(ride.confirm).toEqual([
      { check: 'routine', message: "That's around when you usually start the coffee machine (07:10)." },
    ]);
  });

  it('gates anything unprompted: a source, quiet hours, suppressing rules, never-initiate topics', () => {
    const offer = {
      action: { intent: 'media.play' as const, summary: 'Play Running Mix', topics: [], details: {} },
      proactive: true,
      source: { type: 'context' as const, context: 'workout' as const, text: 'heart rate up' },
    };
    expect(evaluatePreflight(base(offer)).decision).toBe('allow');
    expect(evaluatePreflight(base({ ...offer, source: null })).withheld?.reason).toBe('no_source');
    const asleep = base({ ...offer, quietHours: { active: true, because: ['someone is asleep'] } });
    expect(evaluatePreflight(asleep).withheld?.reason).toBe('quiet_hours');
    expect(evaluatePreflight(base({ ...offer, rules: { ...ALLOW, suppress_offer: true } })).withheld?.reason).toBe(
      'suppressed_by_rule',
    );
    const insulin = { ...offer.action, summary: 'Remind you about insulin', topics: ['health'] };
    expect(evaluatePreflight(base({ ...offer, action: insulin })).withheld?.reason).toBe('never_initiate');
  });

  it("won't announce a delivery nobody ordered, and keeps guests from ordering", () => {
    const notice = (summary: string) =>
      base({ action: { intent: 'notification', summary, topics: ['delivery'], details: {} }, orders: [order(60)] });
    expect(evaluatePreflight(notice('Your couch delivery arrives at 2am')).withheld?.reason).toBe('no_matching_order');
    expect(evaluatePreflight(notice('Your Napoli Pizza order is on its way')).decision).toBe('allow');
    expect(evaluatePreflight(base({ speaker: { role: 'guest' } })).withheld?.reason).toBe('guest');
    expect(evaluatePreflight(base({ speaker: null })).confirm.map((c) => c.check)).toEqual(['speaker']);
  });
});
