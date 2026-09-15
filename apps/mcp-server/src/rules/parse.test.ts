import { describe, expect, it } from 'vitest';
import { type ParsedRule, ruleMessages, structureRule } from './parse.js';

const parsed = (extra: Partial<ParsedRule> = {}): ParsedRule => ({
  effect: 'block',
  intents: ['media.play'],
  topics: [],
  time_from: null,
  time_to: null,
  days: null,
  school_nights: false,
  applies_to: 'household',
  ends: null,
  ...extra,
});

describe('structureRule', () => {
  it('keeps only known intents and clean topics', () => {
    const result = structureRule(
      parsed({ intents: ['media.play', 'dance.party', 'MEDIA.PLAY'], topics: [' Horror film ', 'x'] }),
    );
    expect(result).toMatchObject({ subject: { intents: ['media.play'], topics: ['horror film'] } });
  });

  it('refuses a rule it cannot tie to anything', () => {
    expect(structureRule(parsed({ intents: ['vibes'], topics: [] }))).toEqual({
      error: "I couldn't tell what this rule is about. Could you say it another way?",
    });
  });

  it('completes half-open time windows and drops malformed ones', () => {
    const after10 = structureRule(parsed({ time_from: '22:00', time_to: null }));
    expect(after10).toMatchObject({ condition: { time_from: '22:00', time_to: '06:00' } });
    const before7 = structureRule(parsed({ time_from: null, time_to: '07:00' }));
    expect(before7).toMatchObject({ condition: { time_from: '00:00', time_to: '07:00' } });
    const garbage = structureRule(parsed({ time_from: '10pm', time_to: '25:00' }));
    expect(garbage).toMatchObject({ condition: { time_from: null, time_to: null } });
  });

  it('normalises weekdays and defaults the target to the speaker', () => {
    const result = structureRule(parsed({ days: ['Friday', 'sat', 'someday'], applies_to: ' ' }));
    expect(result).toMatchObject({ condition: { days: ['fri', 'sat'] }, applies_to: 'me' });
  });
});

describe('ruleMessages', () => {
  it('shows worked examples, then the rule with today and the speaker', () => {
    const messages = ruleMessages({
      speaker: 'Emma',
      text: 'No TV during dinner',
      timezone: 'America/New_York',
      now: new Date('2026-09-11T14:00:00Z'),
    });
    expect(messages.map((m) => m.role)).toEqual([
      'system',
      'user',
      'assistant',
      'user',
      'assistant',
      'user',
      'assistant',
      'user',
    ]);
    expect(messages.at(-1)?.content).toBe('Today: Friday 2026-09-11\nSpeaker: Emma\nRule: No TV during dinner');
  });
});
