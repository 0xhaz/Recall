import type { MembershipRole } from './types.js';

// Stated rules (architecture.md §1.5): user- or caregiver-authored constraints, treated as law.
// Pure functions, so enforcement is testable and never left to the model.

export type RuleEffect = 'block' | 'require_confirm' | 'suppress_offer' | 'prefer' | 'allow';
export type RuleSeverity = 'safety' | 'hard' | 'soft';
export type RuleScope = 'person' | 'household' | 'device';
export type Weekday = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';

/** What rules and actions can be about: one vocabulary, so they meet on the same words. */
export const INTENTS = [
  'media.play',
  'order.food',
  'purchase',
  'ride.book',
  'booking',
  'smart_home',
  'reminder',
  'notification',
  'suggestion',
  'call',
  'recipe',
  'any',
] as const;
export type Intent = (typeof INTENTS)[number];

export const WEEKDAYS: readonly Weekday[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
/** Evenings before a school day (Malaysia: school runs Monday to Friday). */
const SCHOOL_NIGHTS = new Set<Weekday>(['sun', 'mon', 'tue', 'wed', 'thu']);

export interface RuleSubject {
  intents: Intent[];
  topics: string[];
}

export interface RuleCondition {
  /** Local HH:MM; a window with from > to runs past midnight. */
  time_from: string | null;
  time_to: string | null;
  days: Weekday[] | null;
  school_nights: boolean;
  devices: string[] | null;
  contexts: string[] | null;
}

export interface RuleView {
  id: string;
  text: string;
  author_id: string | null;
  author_role: MembershipRole;
  scope_type: RuleScope;
  scope_id: string;
  effect: RuleEffect;
  severity: RuleSeverity;
  subject: RuleSubject;
  condition: RuleCondition;
  expires_at: string | null;
  created_at: string;
  hlc: string;
}

export interface ActionCandidate {
  intent: string;
  topics?: string[];
  household_id: string;
  /** Who the action is for, and their role in this household (child and cared_for change precedence). */
  person_id: string | null;
  person_role?: MembershipRole | null;
  device?: string | null;
  contexts?: string[];
  /** When it would happen, in household-local time. */
  local: { weekday: Weekday; time: string };
  now: Date;
}

export interface RuleRef {
  rule_id: string;
  text: string;
}

export interface RuleDecision {
  decision: 'allow' | 'block' | 'require_confirm';
  blocked_by: RuleRef | null;
  confirm: RuleRef[];
  suppress_offer: boolean;
  prefer: RuleRef[];
  applied: RuleRef[];
}

export const isIntent = (value: string): value is Intent => (INTENTS as readonly string[]).includes(value);
export const isWeekday = (value: string): value is Weekday => (WEEKDAYS as readonly string[]).includes(value);

const singular = (word: string) =>
  word.endsWith('ies') && word.length > 4
    ? `${word.slice(0, -3)}y`
    : word.endsWith('s') && !word.endsWith('ss') && word.length > 3
      ? word.slice(0, -1)
      : word;
const topicWords = (topic: string) => (topic.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).map(singular);

function previousDay(day: Weekday): Weekday {
  return WEEKDAYS[(WEEKDAYS.indexOf(day) + 6) % 7] ?? day;
}

function inWindow(time: string, from: string, to: string): boolean {
  return from <= to ? time >= from && time < to : time >= from || time < to;
}

function subjectMatches(subject: RuleSubject, c: ActionCandidate): boolean {
  if (subject.intents.length === 0 && subject.topics.length === 0) return false;
  const intentOk =
    subject.intents.length === 0 || subject.intents.includes('any') || subject.intents.includes(c.intent as Intent);
  const have = new Set((c.topics ?? []).flatMap(topicWords));
  const topicOk =
    subject.topics.length === 0 ||
    subject.topics.some((t) => {
      const need = topicWords(t);
      return need.length > 0 && need.every((w) => have.has(w));
    });
  return intentOk && topicOk;
}

function conditionHolds(k: RuleCondition, c: ActionCandidate): boolean {
  if (k.devices?.length && !(c.device && k.devices.includes(c.device))) return false;
  if (k.contexts?.length && !k.contexts.some((x) => c.contexts?.includes(x))) return false;
  if (k.time_from && k.time_to && !inWindow(c.local.time, k.time_from, k.time_to)) return false;
  // After midnight on an overnight rule it is still "last night": 01:00 Saturday belongs to Friday night.
  const overnight = !!(k.time_from && k.time_to && k.time_from > k.time_to);
  const night = overnight && k.time_to && c.local.time < k.time_to ? previousDay(c.local.weekday) : c.local.weekday;
  if (k.days?.length && !k.days.includes(night)) return false;
  if (k.school_nights && !SCHOOL_NIGHTS.has(night)) return false;
  return true;
}

export function ruleApplies(rule: RuleView, c: ActionCandidate): boolean {
  if (rule.expires_at && Date.parse(rule.expires_at) <= c.now.getTime()) return false;
  if (rule.scope_type === 'person' && rule.scope_id !== c.person_id) return false;
  if (rule.scope_type === 'device' && rule.scope_id !== c.device) return false;
  if (rule.scope_type === 'household' && rule.scope_id !== c.household_id) return false;
  return subjectMatches(rule.subject, c) && conditionHolds(rule.condition, c);
}

/**
 * Precedence, highest first (refines architecture.md §1.5):
 * 0 caregiver safety rules for a cared-for person · 1 a parent's rules for a child ·
 * 2 the person's own rules and shared household/device rules · 3 other caregiver rules.
 * Learned preferences and defaults sit below every stated rule.
 */
export function ruleTier(rule: RuleView, c: Pick<ActionCandidate, 'person_id' | 'person_role'>): number {
  const byOther = rule.author_id !== c.person_id;
  if (rule.severity === 'safety' && rule.author_role === 'caregiver' && c.person_role === 'cared_for') return 0;
  if (
    rule.scope_type === 'person' &&
    c.person_role === 'child' &&
    byOther &&
    ['owner', 'adult'].includes(rule.author_role)
  ) {
    return 1;
  }
  if (rule.author_role === 'caregiver' && byOther) return 3;
  return 2;
}

const isRestrictive = (effect: RuleEffect) =>
  effect === 'block' || effect === 'require_confirm' || effect === 'suppress_offer';

/**
 * Decide an action against the rules. Restrictive rules bind unless an explicit `allow` of
 * strictly higher precedence overrides them; within a tier the most restrictive rule wins.
 */
export function evaluateRules(rules: readonly RuleView[], c: ActionCandidate): RuleDecision {
  const applicable = rules
    .filter((r) => ruleApplies(r, c))
    .map((r) => ({ r, tier: ruleTier(r, c) }))
    .sort((a, b) => a.tier - b.tier);
  const ref = (r: RuleView): RuleRef => ({ rule_id: r.id, text: r.text });

  const allowTiers = applicable.filter((x) => x.r.effect === 'allow').map((x) => x.tier);
  const allowTier = allowTiers.length ? Math.min(...allowTiers) : Number.POSITIVE_INFINITY;
  const binding = applicable.filter((x) => isRestrictive(x.r.effect) && x.tier <= allowTier);

  const blocks = binding.filter((x) => x.r.effect === 'block');
  const confirms = binding.filter((x) => x.r.effect === 'require_confirm');
  const [firstBlock] = blocks;
  const decision: RuleDecision['decision'] = firstBlock ? 'block' : confirms.length ? 'require_confirm' : 'allow';

  return {
    decision,
    blocked_by: firstBlock ? ref(firstBlock.r) : null,
    confirm: decision === 'require_confirm' ? confirms.map((x) => ref(x.r)) : [],
    suppress_offer: decision === 'block' || binding.some((x) => x.r.effect === 'suppress_offer'),
    prefer: decision === 'block' ? [] : applicable.filter((x) => x.r.effect === 'prefer').map((x) => ref(x.r)),
    applied: applicable.map((x) => ref(x.r)),
  };
}

function windowsOverlap(a: RuleCondition, b: RuleCondition): boolean {
  if (!a.time_from || !a.time_to || !b.time_from || !b.time_to) return true;
  for (let minutes = 0; minutes < 24 * 60; minutes += 15) {
    const t = `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
    if (inWindow(t, a.time_from, a.time_to) && inWindow(t, b.time_from, b.time_to)) return true;
  }
  return false;
}

function subjectsOverlap(a: RuleSubject, b: RuleSubject): boolean {
  const anyIntent = (s: RuleSubject) => s.intents.length === 0 || s.intents.includes('any');
  const intents = anyIntent(a) || anyIntent(b) || a.intents.some((i) => b.intents.includes(i));
  const words = (s: RuleSubject) => new Set(s.topics.flatMap(topicWords));
  const topics = a.topics.length === 0 || b.topics.length === 0 || [...words(a)].some((w) => words(b).has(w));
  return intents && topics;
}

function scopesOverlap(a: RuleView, b: RuleView): boolean {
  if (a.scope_type === b.scope_type) return a.scope_id === b.scope_id;
  return true; // household covers everyone; a person uses every device
}

/** Rules that pull the other way on the same thing at overlapping times: surfaced, never resolved silently. */
export function findConflicts(rule: RuleView, others: readonly RuleView[]): RuleView[] {
  return others.filter(
    (o) =>
      o.id !== rule.id &&
      isRestrictive(o.effect) !== isRestrictive(rule.effect) &&
      scopesOverlap(rule, o) &&
      subjectsOverlap(rule.subject, o.subject) &&
      windowsOverlap(rule.condition, o.condition),
  );
}

const EFFECT_TEXT: Record<RuleEffect, string> = {
  block: 'Block',
  require_confirm: 'Ask before',
  suppress_offer: "Don't offer",
  prefer: 'Prefer',
  allow: 'Allow',
};

const INTENT_TEXT: Record<Intent, string> = {
  'media.play': 'playing music or media',
  'order.food': 'ordering food',
  purchase: 'purchases',
  'ride.book': 'booking rides',
  booking: 'bookings',
  smart_home: 'smart-home changes',
  reminder: 'reminders',
  notification: 'announcements',
  suggestion: 'suggestions',
  call: 'calls and messages',
  recipe: 'recipes',
  any: 'anything',
};

/** One line a person can read back: "Block playing music or media 22:00–06:00 on school nights — household". */
export function summarizeRule(rule: RuleView, who: string): string {
  const what = rule.subject.intents.length ? rule.subject.intents.map((i) => INTENT_TEXT[i]).join(' and ') : 'anything';
  const topics = rule.subject.topics.length ? ` involving ${rule.subject.topics.join(', ')}` : '';
  const k = rule.condition;
  const when = [
    k.time_from && k.time_to ? ` ${k.time_from}–${k.time_to}` : '',
    k.school_nights ? ' on school nights' : '',
    k.days?.length ? ` on ${k.days.join(', ')}` : '',
    k.devices?.length ? ` on ${k.devices.join(', ')}` : '',
    k.contexts?.length ? ` during ${k.contexts.join(', ')}` : '',
  ].join('');
  return `${EFFECT_TEXT[rule.effect]} ${what}${topics}${when} — ${who}`;
}
