import type { ContextName } from './context.js';
import { formatMinute } from './routines.js';
import type { Intent, RuleDecision, RuleRef, Weekday } from './rules.js';
import { tagsFor } from './sensitivity.js';
import { temporalStamp } from './temporal.js';
import type { MembershipRole, SensitivityTag } from './types.js';

// Actions through Recall (architecture.md §5, design.md §3.2–3.3, §4.1): checked before they
// happen, offered only with a source, taken back within a window. Pure, so every gate is testable.

export const ACTION_INTENTS = [
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
] as const satisfies readonly Intent[];
export type ActionIntent = (typeof ACTION_INTENTS)[number];

export interface DeviceCommand {
  kind: string;
  payload: Record<string, unknown>;
}

export interface ActionDetails {
  venue?: string;
  address?: string;
  amount?: number;
  currency?: string;
  /** When it would happen (ISO); now if absent. */
  when?: string;
  items?: string[];
}

export type ActionSource =
  | { type: 'routine'; routine_id: string; text: string }
  | { type: 'context'; context: ContextName; text: string };

export interface PastOrder {
  action_id: string;
  intent: string;
  venue: string | null;
  address: string | null;
  amount: number | null;
  items: string[];
  at: string;
}

export type ConfirmCheck = 'rule' | 'speaker' | 'venue' | 'address' | 'duplicate' | 'amount' | 'routine';

export interface ConfirmItem {
  check: ConfirmCheck;
  message: string;
  evidence?: { rule_id?: string; fact_id?: string; action_id?: string };
}

export type WithheldReason =
  | 'quiet_hours'
  | 'suppressed_by_rule'
  | 'never_initiate'
  | 'no_source'
  | 'no_matching_order'
  | 'guest';

export interface Preflight {
  decision: 'allow' | 'confirm' | 'block';
  /** A stated rule that forbids it, quoted word for word. */
  blocked_by: RuleRef | null;
  /** Any other reason it must not happen. */
  withheld: { reason: WithheldReason; message: string } | null;
  confirm: ConfirmItem[];
  message: string;
}

/** How long each kind of action can be taken back; 0: it can't (a call can't be unmade). */
export const UNDO_WINDOW_S: Record<ActionIntent, number> = {
  'media.play': 600,
  smart_home: 600,
  reminder: 3600,
  notification: 3600,
  suggestion: 600,
  recipe: 600,
  'order.food': 120,
  'ride.book': 120,
  booking: 900,
  purchase: 1800,
  call: 0,
};

const MONEY: ReadonlySet<ActionIntent> = new Set(['order.food', 'purchase', 'ride.book', 'booking']);
const ORDERS: ReadonlySet<ActionIntent> = new Set(['order.food', 'purchase']);
const CLASHES: ReadonlySet<ActionIntent> = new Set(['ride.book', 'booking']);
const LOW_RISK: ReadonlySet<ActionIntent> = new Set(['media.play', 'smart_home']);
/** Device kinds that are the person's own doing, sensors, or unsafe to automate: never offered. */
const NEVER_OFFER = new Set([
  'checkin',
  'sleep',
  'hr',
  'health',
  'medication',
  'biometric',
  'door',
  'lock',
  'garage',
  'security',
  'ring',
  'presence',
  'phone',
  'sound',
  'session',
  'context',
  'notice',
]);

const MINUTE_MS = 60_000;
const DUPLICATE_WINDOW_MS = 2 * 60 * MINUTE_MS;
const DELIVERY_MATCH_MS = 14 * 24 * 60 * MINUTE_MS;
const ROUTINE_CLASH_MIN = 30;

/** Signed a − b in minutes of the day, wrapped to [−720, 720): 23:55 is 10 minutes before 00:05. */
export function signedMinutes(a: number, b: number): number {
  return ((((a - b + 720) % 1440) + 1440) % 1440) - 720;
}

export function localClock(timezone: string, at: Date): { weekday: Weekday; time: string } {
  const stamp = temporalStamp(timezone, at);
  return { weekday: stamp.weekday.slice(0, 3).toLowerCase() as Weekday, time: stamp.local_time.slice(0, 5) };
}

/** The intent an offer to repeat a routine would carry, or null when it's never offered. */
export function intentForKind(kind: string): ActionIntent | null {
  const device = kind.split('.')[0] ?? '';
  if (NEVER_OFFER.has(device)) return null;
  if (device === 'media') return kind === 'media.play' ? 'media.play' : null;
  if (device === 'timer' || device === 'alarm' || device === 'reminder') return 'reminder';
  if (device === 'order') return 'order.food';
  if (device === 'call') return 'call';
  return /\.(start|on|play|open|dim|enable)$/.test(kind) ? 'smart_home' : null;
}

const VERBS: Record<string, string> = {
  start: 'start',
  stop: 'stop',
  on: 'turn on',
  off: 'turn off',
  play: 'play',
  open: 'open',
  close: 'close',
  dim: 'dim',
  enable: 'turn on',
  disable: 'turn off',
  cancel: 'cancel',
};

/** "coffee_machine.start" → "start the coffee machine". */
export function describeKind(kind: string, title?: string | null): string {
  if (kind === 'media.play') return title ? `put on ${title}` : 'put on the usual music';
  if (kind === 'media.stop') return 'stop the music';
  const dot = kind.lastIndexOf('.');
  const thing = kind.slice(0, dot).replaceAll('_', ' ').replaceAll('.', ' ');
  const verb = kind.slice(dot + 1);
  return `${VERBS[verb] ?? verb} the ${thing}`;
}

const OPPOSITE_KIND: Record<string, string> = {
  'media.play': 'media.stop',
  'timer.start': 'timer.cancel',
  'alarm.set': 'alarm.cancel',
};
const OPPOSITE_VERB: Record<string, string> = {
  start: 'stop',
  on: 'off',
  open: 'close',
  dim: 'on',
  enable: 'disable',
  subscribe: 'unsubscribe',
};

/** The command that takes a device command back. Locks have none: an "undo" never unlocks a door. */
export function inverseCommand(c: DeviceCommand): DeviceCommand | null {
  const explicit = OPPOSITE_KIND[c.kind];
  if (explicit) return { kind: explicit, payload: c.payload };
  const dot = c.kind.lastIndexOf('.');
  const opposite = OPPOSITE_VERB[c.kind.slice(dot + 1)];
  return dot > 0 && opposite ? { kind: `${c.kind.slice(0, dot)}.${opposite}`, payload: c.payload } : null;
}

export type NeverInitiate = 'health' | 'bereavement' | 'financial' | 'third_party' | 'child';

const TOPIC_CLASS: Record<string, NeverInitiate> = {
  health: 'health',
  medical: 'health',
  medication: 'health',
  doctor: 'health',
  bereavement: 'bereavement',
  funeral: 'bereavement',
  grief: 'bereavement',
  finance: 'financial',
  financial: 'financial',
  money: 'financial',
  bank: 'financial',
  debt: 'financial',
  loan: 'financial',
  child: 'child',
  children: 'child',
};
const BEREAVEMENT = /\b(died|passed away|funeral|death|bereave\w*|condolences?|mourning)\b/i;
const NEVER_TAGS: ReadonlySet<SensitivityTag> = new Set(['health', 'financial', 'third_party', 'child']);

/** Topics the assistant never starts (design.md §3.3): answer-only. */
export function initiationWithheld(text: string, topics: readonly string[] = []): NeverInitiate | null {
  for (const topic of topics) {
    const hit = TOPIC_CLASS[topic.trim().toLowerCase()];
    if (hit) return hit;
  }
  if (BEREAVEMENT.test(text)) return 'bereavement';
  const tag = tagsFor(text).find((t) => NEVER_TAGS.has(t));
  return (tag as NeverInitiate | undefined) ?? null;
}

export type OfferTier = 'inform' | 'suggest' | 'draft' | 'act';

export interface OfferStats {
  accepted: number;
  dismissed: number;
  last: 'executed' | 'dismissed' | 'undone' | null;
}

/**
 * Tiered proactivity (design.md §4.1): money is only ever drafted; low-risk actions start on their
 * own after two accepts, as long as the last answer wasn't no; anything shared (party, festive) asks.
 */
export function offerTier(intent: ActionIntent, stats: OfferStats, context: ContextName | null): OfferTier {
  if (MONEY.has(intent)) return 'draft';
  if (!LOW_RISK.has(intent) || context === 'party' || context === 'festive') return 'suggest';
  return stats.accepted >= 2 && stats.accepted > stats.dismissed && stats.last === 'executed' ? 'act' : 'suggest';
}

/** A fact that states an address ("home address is …", "lives at …", "deliver to …"). */
export const ADDRESS_FACT = /\b(address|lives? at|deliver(?:y|ies)? to)\b/i;
const DELIVERY = /\b(deliver(?:y|ies|ed)?|parcel|package|courier)\b/i;
const STOP_WORDS = new Set([
  'the',
  'and',
  'from',
  'your',
  'our',
  'order',
  'orders',
  'delivery',
  'food',
  'shop',
  'store',
]);

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
const words = (s: string | null | undefined) =>
  new Set(
    norm(s ?? '')
      .split(' ')
      .filter((w) => w.length >= 3 && !STOP_WORDS.has(w)),
  );
/** Every word of the needle appears in the haystack: "12 Jalan Setiawangsa" in "Home is 12 Jalan Setiawangsa, KL". */
function mentions(haystack: string, needle: string): boolean {
  const hay = new Set(norm(haystack).split(' '));
  const wanted = norm(needle).split(' ').filter(Boolean);
  return wanted.length > 0 && wanted.every((w) => hay.has(w));
}

export interface PreflightInput {
  action: { intent: ActionIntent; summary: string; topics: string[]; details: ActionDetails };
  /** An offer the assistant would start, rather than something the person asked for. */
  proactive: boolean;
  source: ActionSource | null;
  speaker: { role: MembershipRole } | null;
  rules: RuleDecision;
  quietHours: { active: boolean; because: string[] };
  knownAddresses: { fact_id: string; content: string }[];
  /** Facts that mention the venue: a place the household knows, even before its first order through Recall. */
  venueFacts: { fact_id: string; content: string }[];
  /** Executed orders and purchases, newest first. */
  orders: PastOrder[];
  /** The person's routines on the day it would happen. */
  routines: { kind: string; minute: number }[];
  whenMinute: number | null;
  now: Date;
}

export function evaluatePreflight(p: PreflightInput): Preflight {
  const { intent, summary, topics, details } = p.action;
  const confirm: ConfirmItem[] = [];
  // The first reason given is the one reported.
  const reasons: NonNullable<Preflight['withheld']>[] = [];
  const withhold = (reason: WithheldReason, message: string) => {
    reasons.push({ reason, message });
  };

  if (p.proactive) {
    if (!p.source) withhold('no_source', 'Nothing on record to base this offer on, so it is not made.');
    if (p.quietHours.active) {
      withhold('quiet_hours', `Quiet hours (${p.quietHours.because.join(', ')}): nothing unprompted.`);
    }
    if (p.rules.suppress_offer) withhold('suppressed_by_rule', 'A stated rule says not to offer this.');
    const topic = initiationWithheld(summary, topics);
    if (topic)
      withhold('never_initiate', `Never brought up unprompted (${topic.replace('_', ' ')}): answer only if asked.`);
  }
  if (MONEY.has(intent)) {
    if (!p.speaker) confirm.push({ check: 'speaker', message: 'Ask who this is for first.' });
    else if (p.speaker.role === 'guest') withhold('guest', "Guests can't order or book on the household's account.");
  }
  if (intent === 'notification' && (DELIVERY.test(summary) || topics.some((t) => DELIVERY.test(t)))) {
    const said = words(summary);
    const matched = p.orders.some(
      (o) =>
        p.now.getTime() - Date.parse(o.at) <= DELIVERY_MATCH_MS &&
        [...words(o.venue), ...o.items.flatMap((i) => [...words(i)])].some((w) => said.has(w)),
    );
    if (!matched) withhold('no_matching_order', 'No order on record matches this delivery, so it is not announced.');
  }

  for (const r of p.rules.confirm) {
    confirm.push({
      check: 'rule',
      message: `“${r.text}” — confirm before going ahead.`,
      evidence: { rule_id: r.rule_id },
    });
  }
  if (ORDERS.has(intent)) confirm.push(...orderChecks(intent, details, p));
  if (CLASHES.has(intent) && p.whenMinute !== null) {
    for (const r of p.routines) {
      if (Math.abs(signedMinutes(r.minute, p.whenMinute)) > ROUTINE_CLASH_MIN) continue;
      confirm.push({
        check: 'routine',
        message: `That's around when you usually ${describeKind(r.kind)} (${formatMinute(r.minute)}).`,
      });
    }
  }

  const blocked_by = p.rules.decision === 'block' ? p.rules.blocked_by : null;
  const final: Preflight['withheld'] = blocked_by ? null : (reasons[0] ?? null);
  const decision = blocked_by || final ? 'block' : confirm.length > 0 ? 'confirm' : 'allow';
  const items = decision === 'block' ? [] : confirm;
  const message = blocked_by
    ? `Not allowed: “${blocked_by.text}”.`
    : final
      ? final.message
      : items.length > 0
        ? `Check with the person first: ${items.map((c) => c.message).join(' ')}`
        : 'Clear to go ahead.';
  return { decision, blocked_by, withheld: final, confirm: items, message };
}

const HOME_WORDS = new Set(['home', 'my home', 'our home', 'the house', 'my place', 'here']);

/** Where the request itself says it should go: the words after its last " to ". */
function requestedDestination(summary: string): string | null {
  const at = summary.toLowerCase().lastIndexOf(' to ');
  if (at < 0) return null;
  const place = summary
    .slice(at + 4)
    .replace(/[.;!?]+$/, '')
    .trim();
  return place && !HOME_WORDS.has(place.toLowerCase()) ? place : null;
}

/** Pre-flight for orders (design.md §3.2 #2): venue used before, the address on record, repeats, amount. */
function orderChecks(intent: ActionIntent, d: ActionDetails, p: PreflightInput): ConfirmItem[] {
  const items: ConfirmItem[] = [];
  const venue = d.venue?.trim() || null;
  const sameKind = p.orders.filter((o) => o.intent === intent);
  const atVenue = venue ? sameKind.filter((o) => o.venue !== null && norm(o.venue) === norm(venue)) : sameKind;
  const known = venue !== null && p.venueFacts.some((f) => mentions(f.content, venue));
  if (venue && atVenue.length === 0 && !known) items.push({ check: 'venue', message: `First order from ${venue}.` });

  const address = d.address?.trim();
  const asked = requestedDestination(p.action.summary);
  if (address && asked && !mentions(address, asked) && !mentions(asked, address)) {
    // The request names one place and the details another: the assistant filled in the wrong one.
    items.push({
      check: 'address',
      message: `The request says “${asked}”, but this would go to ${address}. Which one?`,
    });
  } else if (address) {
    const onRecord = p.knownAddresses.some((f) => mentions(f.content, address));
    const usedBefore = p.orders.some(
      (o) => o.address && (mentions(o.address, address) || mentions(address, o.address)),
    );
    if (!onRecord && !usedBefore) {
      const fact = p.knownAddresses[0];
      const last = p.orders.find((o) => o.address);
      items.push(
        fact
          ? {
              check: 'address',
              message: `Deliver to ${address}? On record: “${fact.content}”.`,
              evidence: { fact_id: fact.fact_id },
            }
          : last
            ? {
                check: 'address',
                message: `Deliver to ${address}? Past orders went to ${last.address}.`,
                evidence: { action_id: last.action_id },
              }
            : { check: 'address', message: `New delivery address: ${address}.` },
      );
    }
  }

  const recent = atVenue.find((o) => p.now.getTime() - Date.parse(o.at) < DUPLICATE_WINDOW_MS);
  if (recent) {
    const minutes = Math.max(1, Math.round((p.now.getTime() - Date.parse(recent.at)) / MINUTE_MS));
    items.push({
      check: 'duplicate',
      message: `Already ordered${venue ? ` from ${venue}` : ''} ${minutes} min ago — another one?`,
      evidence: { action_id: recent.action_id },
    });
  }

  if (d.amount !== undefined) {
    const past = atVenue.map((o) => o.amount).filter((a): a is number => a !== null);
    const most = Math.max(...past);
    if (past.length >= 3 && d.amount > most * 1.5) {
      items.push({
        check: 'amount',
        message: `${d.currency ? `${d.currency} ` : ''}${d.amount} is well above the usual (up to ${most} before).`,
      });
    }
  }
  return items;
}
