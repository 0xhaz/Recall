import { describe, expect, it } from 'vitest';
import { MemoryProjection, type SyncEvent } from './projection.js';
import type { RuleView } from './rules.js';

const rule = (id: string, extra: Partial<RuleView> = {}): RuleView => ({
  id,
  text: id,
  author_id: 'emma',
  author_role: 'owner',
  scope_type: 'household',
  scope_id: 'h',
  effect: 'block',
  severity: 'hard',
  subject: { intents: ['media.play'], topics: [] },
  condition: { time_from: null, time_to: null, days: null, school_nights: false, devices: null, contexts: null },
  expires_at: null,
  created_at: '2026-09-11T00:00:00Z',
  hlc: '',
  ...extra,
});

let seq = 0;
const event = (hlc: string, kind: string, payload: Record<string, unknown>): SyncEvent => ({
  seq: ++seq,
  event_id: `e${seq}`,
  hlc,
  kind,
  device_id: null,
  person_id: null,
  payload,
});

describe('rules in the device projection', () => {
  it('adds rules and drops removed ones for good', () => {
    const p = new MemoryProjection();
    const quiet = rule('quiet');
    p.apply(event('1', 'rule.set', { rule: quiet }));
    p.apply(event('2', 'rule.set', { rule: rule('ask-first', { effect: 'require_confirm' }) }));
    p.apply(event('3', 'rule.removed', { rule_id: 'quiet' }));
    p.apply(event('1', 'rule.set', { rule: quiet })); // a stale replay
    expect(p.currentRules().map((r) => r.id)).toEqual(['ask-first']);
  });

  it('hides expired rules', () => {
    const p = new MemoryProjection();
    p.apply(event('1', 'rule.set', { rule: rule('this week', { expires_at: '2026-09-13T16:00:00Z' }) }));
    expect(p.currentRules(new Date('2026-09-12T00:00:00Z'))).toHaveLength(1);
    expect(p.currentRules(new Date('2026-09-14T00:00:00Z'))).toHaveLength(0);
  });

  it('loads a snapshot taken before rules existed', () => {
    const old = { cursor: 7, facts: {}, removed: {} };
    const p = new MemoryProjection(old);
    expect(p.currentRules()).toEqual([]);
    expect(p.snapshot()).toMatchObject({ cursor: 7, rules: {} });
  });
});
