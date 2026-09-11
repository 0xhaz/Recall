import type { Grant } from './access.js';
import { signedMinutes } from './actions.js';
import { addDays } from './temporal.js';

// Care mode (design.md §5). For a person being cared for, several defaults invert, and the
// inversions are the design, not exceptions: a repeated question gets the same warm answer, only
// caregiver-entered facts are stated, safety topics are corrected and painful ones redirected,
// and movement at night that isn't usual is watched.

export const CARE_MODE_RULES: readonly string[] = [
  'Only state facts entered or confirmed by a caregiver; never infer anything about people or events.',
  'Asked the same thing again: answer the same way, warmly. Never say it was already asked or answered.',
  'Short, calm answers, one idea at a time.',
  'Never start a topic about health; reminders a caregiver set up are the only exception.',
  'If asked what is shared, say it plainly (shared_with).',
];

export interface PastTurn {
  role: 'user' | 'assistant';
  text: string;
  at: string;
}

export interface Repeat {
  asked_before: number;
  /** What was answered last time: in care mode, answer the same way. */
  last_answer: string | null;
  /** The same answer has already been given at least twice. */
  looping: boolean;
  guidance: string;
}

const FILLER = new Set([
  'a',
  'an',
  'the',
  'is',
  'are',
  'am',
  'was',
  'were',
  'be',
  'it',
  'its',
  'to',
  'of',
  'in',
  'on',
  'at',
  'for',
  'me',
  'my',
  'i',
  'you',
  'your',
  'please',
  'can',
  'could',
  'would',
  'will',
  'do',
  'does',
  'did',
  'what',
  'whats',
  'when',
  'where',
  'who',
  'how',
  'alexa',
  'hey',
  'tell',
  'again',
  'now',
  'so',
  'and',
  'or',
  'there',
  'that',
  'this',
]);

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
const contentWords = (s: string) =>
  new Set(
    s
      .toLowerCase()
      .replace(/[^a-z0-9\s]+/g, '')
      .split(/\s+/)
      .filter((w) => w && !FILLER.has(w)),
  );

/** The same question in other words: most of the meaningful words shared. */
export function sameQuestion(a: string, b: string): boolean {
  const x = contentWords(a);
  const y = contentWords(b);
  if (x.size === 0 || y.size === 0) return false;
  let shared = 0;
  for (const w of x) if (y.has(w)) shared++;
  return shared / Math.max(x.size, y.size) >= 0.6;
}

/**
 * The repeat detector (architecture.md §5), profile-aware. Normally it speaks up only when the same
 * answer has been given twice and the question comes again: abstain and offer another way. In care
 * mode repetition is expected: any repeat returns the last answer, to be given again the same way.
 */
export function detectRepeat(hint: string, turns: readonly PastTurn[], mode: 'normal' | 'cared_for'): Repeat | null {
  const past = [...turns];
  // The request itself may already be in the log.
  const newest = past.at(-1);
  if (newest?.role === 'user' && sameQuestion(newest.text, hint)) past.pop();

  const answers: string[] = [];
  past.forEach((turn, i) => {
    if (turn.role !== 'user' || !sameQuestion(turn.text, hint)) return;
    const next = past[i + 1];
    answers.push(next?.role === 'assistant' ? next.text : '');
  });
  if (answers.length === 0) return null;

  const given = answers.filter(Boolean);
  const last = given.at(-1) ?? null;
  const looping = given.length >= 2 && sameQuestion(given.at(-1) ?? '', given.at(-2) ?? '');
  if (mode === 'cared_for') {
    return {
      asked_before: answers.length,
      last_answer: last,
      looping,
      guidance:
        'Asked before today. Answer again, warmly, in the same words as last time. Never say it was asked before or ' +
        'that you already answered.',
    };
  }
  if (!looping) return null;
  return {
    asked_before: answers.length,
    last_answer: last,
    looping,
    guidance:
      "The same answer has been given twice and they're asking again: say plainly that you don't have more than " +
      'that, and offer another way (a different source, someone who would know, or to leave it).',
  };
}

export type CareStance = 'correct' | 'redirect';

export interface CarePolicy {
  topic: string;
  keywords: string[];
  policy: CareStance;
  guidance: string | null;
  set_by: 'default' | 'caregiver';
}

/** Standard dementia-care guidance: correct for safety, redirect rather than argue or re-inflict grief. */
export const DEFAULT_CARE_POLICIES: readonly CarePolicy[] = [
  {
    topic: 'stove and cooking',
    keywords: ['stove', 'cooker', 'gas', 'oven', 'cooking', 'kettle'],
    policy: 'correct',
    guidance: 'Safety first: say plainly what is true (the stove is off), or ask them to wait for help.',
    set_by: 'default',
  },
  {
    topic: 'doors and going out',
    keywords: ['door', 'doors', 'lock', 'outside', 'go out', 'going out'],
    policy: 'correct',
    guidance: "Safety first: be clear about whether it's safe to go out now; at night, suggest waiting for a carer.",
    set_by: 'default',
  },
  {
    topic: 'medication',
    keywords: ['medicine', 'medicines', 'medication', 'pill', 'pills', 'tablet', 'tablets'],
    policy: 'correct',
    guidance: 'Only what a caregiver entered: when it is due and whether it was taken. Never advise on doses.',
    set_by: 'default',
  },
  {
    topic: 'going home',
    keywords: ['go home', 'going home', 'take me home', 'want to go home'],
    policy: 'redirect',
    guidance: 'Don\'t argue that this is home. Reassure ("you\'re safe here"), then turn to something familiar.',
    set_by: 'default',
  },
];

/** A caregiver's policy for a topic replaces the default one. */
export function mergeCarePolicies(own: readonly CarePolicy[]): CarePolicy[] {
  const topics = new Set(own.map((p) => norm(p.topic)));
  return [...own, ...DEFAULT_CARE_POLICIES.filter((p) => !topics.has(norm(p.topic)))];
}

/** The policies a request touches, by whole words or phrases. */
export function matchCarePolicies(text: string, policies: readonly CarePolicy[]): CarePolicy[] {
  const said = ` ${norm(text)} `;
  return policies.filter((p) => p.keywords.some((k) => norm(k) !== '' && said.includes(` ${norm(k)} `)));
}

export function keywordsFor(topic: string): string[] {
  return [...contentWords(topic)].filter((w) => w.length >= 3);
}

const SHARED_BY_GRANT: [Grant, string][] = [
  ['view_daily', 'your check-ins'],
  ['edit_care_plan', 'your reminders'],
  ['view_full_memory', "everything you've told me"],
];

const listed = (xs: readonly string[]) =>
  xs.length <= 1 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`;

/** Said plainly to the person, never covert (design.md §5): "Farah can see your check-ins and your reminders." */
export function sharedWith(caregivers: readonly { name: string; grants: readonly Grant[] }[]): string[] {
  return caregivers.map((c) => {
    const what = SHARED_BY_GRANT.filter(([grant]) => c.grants.includes(grant)).map(([, label]) => label);
    return what.length > 0 ? `${c.name} can see ${listed(what)}.` : `${c.name} helps look after you.`;
  });
}

/** Presence escalation (design.md §5): door or movement at night that isn't usual → carers. */
export const PRESENCE_KIND = /^(door|motion|ring)\./;
const NIGHT_FROM = 22 * 60;
const NIGHT_TO = 6 * 60;
const USUAL_WITHIN_MIN = 45;
const USUAL_DAYS = 3;

export function isNight(minute: number): boolean {
  return minute >= NIGHT_FROM || minute < NIGHT_TO;
}

/** The night an early-morning event belongs to: 02:10 on the 12th is the night of the 11th. */
export function nightOf(date: string, minute: number): string {
  return minute < NIGHT_TO ? addDays(date, -1) : date;
}

/** Usual when the same thing happened within 45 minutes of this time on at least 3 recent days. */
export function isUsualAt(minute: number, history: readonly { local_date: string; local_minute: number }[]): boolean {
  const days = new Set(
    history.filter((h) => Math.abs(signedMinutes(h.local_minute, minute)) <= USUAL_WITHIN_MIN).map((h) => h.local_date),
  );
  return days.size >= USUAL_DAYS;
}

const PRESENCE_LABELS: readonly [RegExp, string][] = [
  [/^door\.open/, 'The door opened'],
  [/^door\.unlock/, 'The door was unlocked'],
  [/^ring\./, 'Movement at the front door'],
  [/^motion\./, 'Movement'],
  [/^door\./, 'Door activity'],
];

export function presenceAlertText(kind: string, where: string | null, time: string, names: readonly string[]): string {
  const label = PRESENCE_LABELS.find(([pattern]) => pattern.test(kind))?.[1] ?? 'Activity';
  const who = names.length > 0 ? ` ${listed(names)} may be up.` : '';
  return `${label}${where ? ` (${where})` : ''} at ${time}, which is unusual at night.${who}`;
}
