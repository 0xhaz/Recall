import {
  INTENTS,
  isIntent,
  isWeekday,
  type RuleCondition,
  type RuleEffect,
  type RuleSubject,
  temporalStamp,
} from '@recall/core';
import type { ChatMessage } from '@recall/llm';
import * as z from 'zod';

// Turning "No music after 10pm on school nights" into structure. The model proposes; these rules
// decide what is kept, so a vague or garbled parse never becomes law.

export const ParsedRule = z.object({
  effect: z.enum(['block', 'require_confirm', 'suppress_offer', 'prefer', 'allow']),
  intents: z.array(z.string()),
  topics: z.array(z.string()),
  time_from: z.string().nullable(),
  time_to: z.string().nullable(),
  days: z.array(z.string()).nullable(),
  school_nights: z.boolean(),
  applies_to: z.string(),
  ends: z.string().nullable(),
});
export type ParsedRule = z.infer<typeof ParsedRule>;

export interface StructuredRule {
  effect: RuleEffect;
  subject: RuleSubject;
  condition: RuleCondition;
  applies_to: string;
  ends: string | null;
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export function structureRule(p: ParsedRule): StructuredRule | { error: string } {
  const intents = [...new Set(p.intents.map((i) => i.trim().toLowerCase()).filter(isIntent))];
  const topics = [...new Set(p.topics.map((t) => t.trim().toLowerCase()).filter((t) => t.length > 1 && t.length < 60))];
  if (intents.length === 0 && topics.length === 0) {
    return { error: "I couldn't tell what this rule is about. Could you say it another way?" };
  }
  let from = p.time_from && HHMM.test(p.time_from) ? p.time_from : null;
  let to = p.time_to && HHMM.test(p.time_to) ? p.time_to : null;
  // "after 10pm" runs through the night; "before 7am" starts at midnight.
  if (from && !to) to = from >= '12:00' ? '06:00' : '23:59';
  if (to && !from) from = '00:00';
  const days = (p.days ?? []).map((d) => d.trim().slice(0, 3).toLowerCase()).filter(isWeekday);
  return {
    effect: p.effect,
    subject: { intents, topics },
    condition: {
      time_from: from,
      time_to: to,
      days: days.length ? [...new Set(days)] : null,
      school_nights: p.school_nights,
      devices: null,
      contexts: null,
    },
    applies_to: p.applies_to.trim() || 'me',
    ends: p.ends?.trim() || null,
  };
}

export const RULE_SCHEMA = {
  type: 'object',
  required: ['effect', 'intents', 'topics', 'time_from', 'time_to', 'days', 'school_nights', 'applies_to', 'ends'],
  properties: {
    effect: { enum: ['block', 'require_confirm', 'suppress_offer', 'prefer', 'allow'] },
    intents: { type: 'array', items: { enum: [...INTENTS] } },
    topics: { type: 'array', items: { type: 'string' } },
    time_from: { type: ['string', 'null'] },
    time_to: { type: ['string', 'null'] },
    days: { type: ['array', 'null'], items: { enum: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] } },
    school_nights: { type: 'boolean' },
    applies_to: { type: 'string' },
    ends: { type: ['string', 'null'] },
  },
};

const RULE_SYSTEM = [
  'You turn a rule a household member tells their voice assistant into structured form.',
  '- effect: "block" = never do it; "require_confirm" = ask first; "suppress_offer" = don\'t suggest it, but do it if asked; "prefer" = favour it; "allow" = explicitly permitted.',
  `- intents: what it is about, only from: ${INTENTS.join(', ')}.`,
  '- topics: specific things named ("peanut", "horror film"), lowercase, singular. Empty if none.',
  '- time_from / time_to: 24-hour HH:MM when the rule has a time window ("after 10pm" is 22:00 to 06:00); otherwise null.',
  '- days: weekdays it applies (mon..sun) or null. school_nights: true only if it says school nights.',
  '- applies_to: "me" if it is about the speaker, "household" if about everyone or the house, or the name of the person it is for.',
  '- ends: the speaker\'s own words for when the rule stops ("until Friday", "this month"), otherwise null. Never write a date.',
  'Reply with JSON only.',
].join('\n');

const EXAMPLES: [string, ParsedRule][] = [
  [
    'Speaker: Aisyah\nRule: No music after 10pm on school nights',
    {
      effect: 'block',
      intents: ['media.play'],
      topics: [],
      time_from: '22:00',
      time_to: '06:00',
      days: null,
      school_nights: true,
      applies_to: 'household',
      ends: null,
    },
  ],
  [
    'Speaker: Daniel\nRule: Always ask me before you order anything, until the end of the month',
    {
      effect: 'require_confirm',
      intents: ['order.food', 'purchase', 'ride.book', 'booking'],
      topics: [],
      time_from: null,
      time_to: null,
      days: null,
      school_nights: false,
      applies_to: 'me',
      ends: 'the end of the month',
    },
  ],
  [
    'Speaker: Aisyah\nRule: Never suggest recipes with peanuts for Sofia',
    {
      effect: 'block',
      intents: ['recipe', 'suggestion'],
      topics: ['peanut'],
      time_from: null,
      time_to: null,
      days: null,
      school_nights: false,
      applies_to: 'Sofia',
      ends: null,
    },
  ],
];

export function ruleMessages(input: { speaker: string; text: string; timezone: string; now: Date }): ChatMessage[] {
  const today = temporalStamp(input.timezone, input.now);
  return [
    { role: 'system', content: RULE_SYSTEM },
    ...EXAMPLES.flatMap(([user, reply]): ChatMessage[] => [
      { role: 'user', content: user },
      { role: 'assistant', content: JSON.stringify(reply) },
    ]),
    {
      role: 'user',
      content: `Today: ${today.weekday} ${today.local_date}\nSpeaker: ${input.speaker}\nRule: ${input.text}`,
    },
  ];
}
