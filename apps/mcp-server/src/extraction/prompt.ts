import { temporalStamp } from '@recall/core';
import type { ChatMessage } from '@recall/llm';
import * as z from 'zod';

// Prompts for the extraction worker. Tuned against qwen3:8b (workplan WS3): small models need a
// worked example, and get dates wrong — so they return the speaker's words for when something
// ends, and resolveEnd() does the calendar maths.

export const EXTRACTION_SCHEMA = {
  type: 'object',
  required: ['facts'],
  properties: {
    facts: {
      type: 'array',
      items: {
        type: 'object',
        required: ['content', 'type', 'scope', 'firm', 'ends'],
        properties: {
          content: { type: 'string' },
          type: { enum: ['semantic', 'episodic', 'procedural'] },
          scope: { enum: ['person', 'household'] },
          firm: { type: 'boolean' },
          ends: { type: ['string', 'null'] },
        },
      },
    },
  },
};

const EXTRACTION_SYSTEM = [
  'You extract memory facts from one statement a household member made to their voice assistant.',
  'Rules:',
  '- Only facts the speaker states about themselves or their household. Never infer, generalise or embellish.',
  "- Write each fact as one short third-person sentence using the speaker's name. Do not put dates or end times in the sentence.",
  '- type: "semantic" = stable fact or preference; "episodic" = an event or a temporary situation; "procedural" = a habit or routine (how or when they usually do something).',
  '- scope: "person" unless the statement is explicitly about the whole household ("we", "our family", "at home we").',
  '- ends: for a temporary situation, the speaker\'s own words for when it ends, such as "Wednesday", "this week", "tomorrow" or "for two weeks"; otherwise null. Never write a date.',
  '- firm: true if stated as a fact or a preference ("I am", "I always", "remember that"); false if mentioned in passing.',
  '- Skip requests, questions, small talk, and details about people outside the household.',
  'Reply with JSON only.',
].join('\n');

const EXAMPLE = {
  speaker: 'Daniel',
  statement:
    "We always order from Warung Mak Teh on Fridays. I've started running in the mornings, and I'm off coffee this week. Can you set a timer?",
  timezone: 'Asia/Kuala_Lumpur',
  now: new Date('2026-09-14T02:00:00Z'), // Monday morning in Kuala Lumpur
};

const EXAMPLE_REPLY = {
  facts: [
    {
      content: 'The household usually orders from Warung Mak Teh on Fridays',
      type: 'procedural',
      scope: 'household',
      firm: true,
      ends: null,
    },
    {
      content: 'Daniel has started running in the mornings',
      type: 'procedural',
      scope: 'person',
      firm: false,
      ends: null,
    },
    { content: 'Daniel is off coffee', type: 'episodic', scope: 'person', firm: true, ends: 'this week' },
  ],
};

export interface StatementInput {
  speaker: string;
  statement: string;
  timezone: string;
  now: Date;
}

export function statementMessage({ speaker, statement, timezone, now }: StatementInput): string {
  const today = temporalStamp(timezone, now);
  return [`Today: ${today.weekday} ${today.local_date}`, `Speaker: ${speaker}`, `Statement: ${statement}`].join('\n');
}

export function extractionMessages(input: StatementInput): ChatMessage[] {
  return [
    { role: 'system', content: EXTRACTION_SYSTEM },
    { role: 'user', content: statementMessage(EXAMPLE) },
    { role: 'assistant', content: JSON.stringify(EXAMPLE_REPLY) },
    { role: 'user', content: statementMessage(input) },
  ];
}

export const JUDGE_SCHEMA = {
  type: 'object',
  required: ['verdict', 'match'],
  properties: {
    verdict: { enum: ['same', 'updates', 'new'] },
    match: { type: ['integer', 'null'] },
  },
};

export const JudgeReply = z.object({
  verdict: z.enum(['same', 'updates', 'new']),
  match: z.number().int().nullable(),
});

const JUDGE_SYSTEM = [
  'Compare a new memory fact with existing facts about the same person or household.',
  'verdict "same": it says the same thing as one of them, even in other words.',
  'verdict "updates": it replaces, corrects or contradicts one of them (a change of diet, time, place or status).',
  'verdict "new": it is about something else.',
  'match: the number of the existing fact for "same" or "updates"; null for "new".',
  'Reply with JSON only.',
].join('\n');

export function judgeMessages(candidate: string, existing: readonly string[]): ChatMessage[] {
  const numbered = existing.map((fact, i) => `${i + 1}. ${fact}`).join('\n');
  return [
    { role: 'system', content: JUDGE_SYSTEM },
    { role: 'user', content: `New: ${candidate}\nExisting:\n${numbered}` },
  ];
}
