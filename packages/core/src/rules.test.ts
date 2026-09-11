import { describe, expect, it } from 'vitest';
import {
  type ActionCandidate,
  evaluateRules,
  findConflicts,
  type RuleView,
  ruleApplies,
  summarizeRule,
  type Weekday,
} from './rules.js';

const H = 'household-1';

const rule = (id: string, extra: Partial<RuleView> = {}): RuleView => ({
  id,
  text: id,
  author_id: 'aisyah',
  author_role: 'owner',
  scope_type: 'household',
  scope_id: H,
  effect: 'block',
  severity: 'hard',
  subject: { intents: ['media.play'], topics: [] },
  condition: { time_from: null, time_to: null, days: null, school_nights: false, devices: null, contexts: null },
  expires_at: null,
  created_at: '2026-09-11T00:00:00Z',
  hlc: '1',
  ...extra,
});

const action = (weekday: Weekday, time: string, extra: Partial<ActionCandidate> = {}): ActionCandidate => ({
  intent: 'media.play',
  household_id: H,
  person_id: 'daniel',
  person_role: 'adult',
  local: { weekday, time },
  now: new Date('2026-09-11T12:00:00Z'),
  ...extra,
});

const quietSchoolNights = rule('no music after 10pm on school nights', {
  condition: { time_from: '22:00', time_to: '06:00', days: null, school_nights: true, devices: null, contexts: null },
});

describe('when a rule applies', () => {
  it('runs an overnight window on school nights, counting after midnight as the night before', () => {
    expect(ruleApplies(quietSchoolNights, action('sun', '22:30'))).toBe(true); // school tomorrow
    expect(ruleApplies(quietSchoolNights, action('mon', '01:00'))).toBe(true); // still Sunday night
    expect(ruleApplies(quietSchoolNights, action('fri', '22:30'))).toBe(false); // no school Saturday
    expect(ruleApplies(quietSchoolNights, action('sat', '01:00'))).toBe(false); // Friday night
    expect(ruleApplies(quietSchoolNights, action('tue', '21:59'))).toBe(false);
    expect(ruleApplies(quietSchoolNights, action('tue', '06:00'))).toBe(false);
  });

  it('matches topics by words, plurals included', () => {
    const peanuts = rule('never peanut recipes', { subject: { intents: ['recipe'], topics: ['peanuts'] } });
    expect(ruleApplies(peanuts, action('mon', '12:00', { intent: 'recipe', topics: ['Peanut butter noodles'] }))).toBe(
      true,
    );
    expect(ruleApplies(peanuts, action('mon', '12:00', { intent: 'recipe', topics: ['laksa'] }))).toBe(false);
    expect(ruleApplies(peanuts, action('mon', '12:00', { intent: 'media.play', topics: ['peanut'] }))).toBe(false);
  });

  it('respects scope, device and expiry', () => {
    expect(ruleApplies(rule('mine', { scope_type: 'person', scope_id: 'aisyah' }), action('mon', '12:00'))).toBe(false);
    expect(
      ruleApplies(rule('kitchen', { scope_type: 'device', scope_id: 'kitchen-echo' }), action('mon', '12:00')),
    ).toBe(false);
    expect(
      ruleApplies(
        rule('kitchen', { scope_type: 'device', scope_id: 'kitchen-echo' }),
        action('mon', '12:00', { device: 'kitchen-echo' }),
      ),
    ).toBe(true);
    expect(ruleApplies(rule('old', { expires_at: '2026-09-10T00:00:00Z' }), action('mon', '12:00'))).toBe(false);
  });
});

describe('evaluateRules', () => {
  it('blocks, naming the rule in its own words', () => {
    const result = evaluateRules([quietSchoolNights], action('sun', '22:30'));
    expect(result).toMatchObject({
      decision: 'block',
      blocked_by: { rule_id: quietSchoolNights.id, text: 'no music after 10pm on school nights' },
      suppress_offer: true,
    });
    expect(evaluateRules([quietSchoolNights], action('sat', '22:30')).decision).toBe('allow');
  });

  it("keeps a household rule binding even against a person's own allow in the same tier", () => {
    const danielAllows = rule('daniel: music any time', { author_id: 'daniel', author_role: 'adult', effect: 'allow' });
    expect(evaluateRules([quietSchoolNights, danielAllows], action('sun', '22:30')).decision).toBe('block');
  });

  it("lets the person's own allow override another caregiver's non-safety rule", () => {
    const caregiver = rule('caregiver: no music', {
      author_id: 'farah',
      author_role: 'caregiver',
      scope_type: 'person',
      scope_id: 'som',
    });
    const somAllows = rule('som: I may play music', {
      author_id: 'som',
      author_role: 'cared_for',
      scope_type: 'person',
      scope_id: 'som',
      effect: 'allow',
    });
    const som = action('mon', '12:00', { person_id: 'som', person_role: 'cared_for' });
    expect(evaluateRules([caregiver, somAllows], som).decision).toBe('allow');
    expect(evaluateRules([caregiver], som).decision).toBe('block');
  });

  it("puts a caregiver's safety rule above the person's own wishes", () => {
    const stove = rule('never turn on the stove', {
      author_id: 'farah',
      author_role: 'caregiver',
      severity: 'safety',
      scope_type: 'person',
      scope_id: 'som',
      subject: { intents: ['smart_home'], topics: ['stove'] },
    });
    const somAllows = rule('som: I can use the stove', {
      author_id: 'som',
      author_role: 'cared_for',
      scope_type: 'person',
      scope_id: 'som',
      effect: 'allow',
      subject: { intents: ['smart_home'], topics: ['stove'] },
    });
    const result = evaluateRules(
      [somAllows, stove],
      action('mon', '12:00', { intent: 'smart_home', topics: ['stove'], person_id: 'som', person_role: 'cared_for' }),
    );
    expect(result.blocked_by?.text).toBe('never turn on the stove');
  });

  it("puts a parent's rule for a child above the child's own", () => {
    const parent = rule('no videos after 8pm for Sofia', {
      scope_type: 'person',
      scope_id: 'sofia',
      condition: {
        time_from: '20:00',
        time_to: '06:00',
        days: null,
        school_nights: false,
        devices: null,
        contexts: null,
      },
    });
    const sofia = rule('sofia: videos any time', {
      author_id: 'sofia',
      author_role: 'child',
      scope_type: 'person',
      scope_id: 'sofia',
      effect: 'allow',
    });
    const late = action('sat', '21:00', { person_id: 'sofia', person_role: 'child' });
    expect(evaluateRules([sofia, parent], late).decision).toBe('block');
  });

  it('asks first, suppresses offers, and passes preferences through', () => {
    const confirm = rule('ask before ordering', {
      effect: 'require_confirm',
      subject: { intents: ['order.food'], topics: [] },
    });
    const quiet = rule('no food suggestions', {
      effect: 'suppress_offer',
      subject: { intents: ['order.food'], topics: [] },
    });
    const prefer = rule('prefer Warung Mak Teh', {
      effect: 'prefer',
      subject: { intents: ['order.food'], topics: [] },
    });
    const result = evaluateRules([confirm, quiet, prefer], action('mon', '19:00', { intent: 'order.food' }));
    expect(result).toMatchObject({ decision: 'require_confirm', suppress_offer: true });
    expect(result.confirm.map((r) => r.text)).toEqual(['ask before ordering']);
    expect(result.prefer.map((r) => r.text)).toEqual(['prefer Warung Mak Teh']);
  });
});

describe('findConflicts', () => {
  it('flags rules that pull the other way on the same thing at overlapping times', () => {
    const workoutMusic = rule('always play music when I work out', {
      author_id: 'daniel',
      author_role: 'adult',
      scope_type: 'person',
      scope_id: 'daniel',
      effect: 'prefer',
    });
    const morningOnly = rule('music in the morning', {
      effect: 'allow',
      condition: {
        time_from: '07:00',
        time_to: '09:00',
        days: null,
        school_nights: false,
        devices: null,
        contexts: null,
      },
    });
    expect(findConflicts(workoutMusic, [quietSchoolNights]).map((r) => r.id)).toEqual([quietSchoolNights.id]);
    expect(findConflicts(morningOnly, [quietSchoolNights])).toEqual([]);
    expect(
      findConflicts(rule('no calls', { subject: { intents: ['call'], topics: [] }, effect: 'allow' }), [
        quietSchoolNights,
      ]),
    ).toEqual([]);
  });
});

describe('summarizeRule', () => {
  it('reads back as one line', () => {
    expect(summarizeRule(quietSchoolNights, 'household')).toBe(
      'Block playing music or media 22:00–06:00 on school nights — household',
    );
  });
});
