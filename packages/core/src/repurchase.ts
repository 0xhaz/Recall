// Repurchase cycles (architecture.md §2): the things a household buys again and again — wet food
// every week, filters every few months, batteries when they die. Mined from what was actually
// bought through Recall, never guessed by a model, so the same history always gives the same answer.
//
// Two sources, and the person's own words win, exactly as a stated rule beats a mined routine:
//   stated  — "I buy wet food every week", parsed from a fact.
//   mined   — the median gap between executed purchases of the same item.
//
// What this deliberately does NOT claim: that the cupboard is empty. Recall only sees what was
// bought through it. Every item carries `bought` and `last_date` so the assistant can say "you
// last ordered this on the 3rd" rather than "you have run out".

const DAY_MS = 86_400_000;
const MIN_INTERVALS = 2; // three purchases before we will claim a cycle
const FULL_EVIDENCE = 4; // four gaps is as sure as this gets
const ABANDONED = 3; // silent for three cycles: they stopped buying it
const STATED_CONFIDENCE = 0.9;

export interface PastPurchase {
  action_id: string;
  /** Who it was for; null for the household. */
  person_id: string | null;
  /** The item as it was said, one row per item. */
  label: string;
  venue: string | null;
  amount: number | null;
  /** Household-local date, YYYY-MM-DD. */
  local_date: string;
}

export interface StatedCadence {
  item: string;
  every_days: number;
  fact_id: string;
  text: string;
}

export interface RepeatItem {
  /** Normalised key: what "12 x Wet Food (large)" and "wet food" have in common. */
  item: string;
  /** Most recent spelling — what to say out loud. */
  label: string;
  every_days: number;
  /** How much the gap varies, in days; 0 when stated. */
  spread_days: number;
  confidence: number;
  source: 'stated' | 'mined';
  /** Quoted when the cycle came from something the person said. */
  said: { fact_id: string; text: string } | null;
  bought: number;
  /** Empty when the cycle was stated but nothing has been bought through Recall yet. */
  last_date: string;
  last_venue: string | null;
  /** Negative when it is overdue; null when nothing has been bought, so there is nothing to count from. */
  due_in_days: number | null;
  due: boolean;
}

export interface RepurchaseOptions {
  today: string;
  /** Ignore purchases older than this; defaults to a year, so quarterly items still have a cycle. */
  windowDays?: number;
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
}

const PACK = /\b(?:\d+(?:\.\d+)?\s*(?:x|pk|pack|packs|ct|count|g|kg|ml|l|lb|oz|litre|liters?)|x\s*\d+)\b/g;
const QUANTITY_PARENS = /\([^)]*\d[^)]*\)|\((?:pack|packs|large|small|value)\)/g;

/** "12 x Wet Food Pouches (large pack)" and "wet food pouches" are the same thing to buy again. */
export function normaliseItem(raw: string): string {
  return raw
    .toLowerCase()
    .replace(QUANTITY_PARENS, ' ')
    .replace(PACK, ' ')
    .replace(/^\s*\d+\s+/, '')
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const UNIT_DAYS: Record<string, number> = { day: 1, week: 7, fortnight: 14, month: 30, year: 365 };
const WORD_COUNT: Record<string, number> = { a: 1, an: 1, one: 1, other: 2, two: 2, three: 3, four: 4, six: 6 };
// "I buy wet food every week" / "we replace the water filter every 3 months" / "I order litter monthly".
const CADENCE =
  /\b(?:buy|get|order|restock|replace|change|refill|pick up)\s+(?:the|a|an|some|our|my)?\s*(.{2,60}?)\s+(?:(?:every|each)\s+(\d+|a|an|one|other|two|three|four|six)?\s*(day|week|fortnight|month|year)s?|(weekly|fortnightly|monthly|yearly|daily))\b/i;

/** Reads a repeat cycle out of something the person said. Null when the text does not state one. */
export function statedCadence(text: string): { item: string; every_days: number } | null {
  const m = CADENCE.exec(text);
  if (!m) return null;
  const [, rawItem = '', count, unit, adverb] = m;
  const every_days = adverb
    ? (UNIT_DAYS[adverb.toLowerCase().replace(/ly$/, '').replace('dai', 'day')] ?? 0)
    : (count ? (WORD_COUNT[count.toLowerCase()] ?? Number(count)) : 1) * (UNIT_DAYS[unit?.toLowerCase() ?? ''] ?? 0);
  const item = normaliseItem(rawItem);
  return every_days > 0 && item ? { item, every_days } : null;
}

const median = (xs: readonly number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  const hi = s[mid] ?? 0;
  return s.length % 2 ? hi : Math.round(((s[mid - 1] ?? hi) + hi) / 2);
};

const round2 = (n: number): number => Math.round(n * 100) / 100;

interface Seen {
  label: string;
  person_id: string | null;
  venue: string | null;
  dates: string[];
}

/**
 * What this household buys on a cycle, soonest-due first. `stated` cycles override mined ones for
 * the same item: the person told us, so we do not argue with the arithmetic.
 */
export function mineRepurchases(
  purchases: readonly PastPurchase[],
  stated: readonly StatedCadence[],
  opts: RepurchaseOptions,
): RepeatItem[] {
  const from = isoMinus(opts.today, opts.windowDays ?? 365);
  const seen = new Map<string, Seen>();
  for (const p of purchases) {
    if (p.local_date < from || p.local_date > opts.today) continue;
    const item = normaliseItem(p.label);
    if (!item) continue;
    const prior = seen.get(item);
    // Newest wins for how we say it and where it came from; two rows on one day are one shop.
    const newest = !prior || p.local_date >= (prior.dates[0] ?? '');
    const dates = prior?.dates.includes(p.local_date) ? prior.dates : [...(prior?.dates ?? []), p.local_date];
    seen.set(item, {
      label: newest || !prior ? p.label : prior.label,
      person_id: newest || !prior ? p.person_id : prior.person_id,
      venue: newest || !prior ? p.venue : prior.venue,
      dates: [...dates].sort((a, b) => b.localeCompare(a)),
    });
  }

  const byItem = new Map<string, StatedCadence>();
  for (const s of stated) byItem.set(normaliseItem(s.item), s);

  const found: RepeatItem[] = [];
  for (const [item, s] of seen) {
    const last = s.dates[0];
    if (!last) continue;
    const says = byItem.get(item);
    const cycle = says ? { every_days: says.every_days, spread_days: 0 } : minedCycle(s.dates);
    if (!cycle) continue;
    const since = daysBetween(last, opts.today);
    if (!says && since > cycle.every_days * ABANDONED) continue; // they stopped buying it
    const due_in_days = cycle.every_days - since;
    found.push({
      item,
      label: s.label,
      every_days: cycle.every_days,
      spread_days: cycle.spread_days,
      confidence: says ? STATED_CONFIDENCE : confidenceOf(s.dates.length - 1, cycle),
      source: says ? 'stated' : 'mined',
      said: says ? { fact_id: says.fact_id, text: says.text } : null,
      bought: s.dates.length,
      last_date: last,
      last_venue: s.venue,
      due_in_days,
      due: due_in_days <= Math.max(1, Math.round(cycle.spread_days / 2)),
    });
  }

  // A cycle they stated but have never bought through Recall still belongs on the list — we know how
  // often they replace it. We do not know when they last did, so it is never called due: there is
  // nothing to count from, and guessing would be exactly the invention this tool promises not to make.
  for (const [item, says] of byItem) {
    if (seen.has(item)) continue;
    found.push({
      item,
      label: says.item,
      every_days: says.every_days,
      spread_days: 0,
      confidence: STATED_CONFIDENCE,
      source: 'stated',
      said: { fact_id: says.fact_id, text: says.text },
      bought: 0,
      last_date: '',
      last_venue: null,
      due_in_days: null,
      due: false,
    });
  }
  return found.sort(
    (a, b) => (a.due_in_days ?? Infinity) - (b.due_in_days ?? Infinity) || a.item.localeCompare(b.item),
  );
}

function minedCycle(newestFirst: readonly string[]): { every_days: number; spread_days: number } | null {
  if (newestFirst.length - 1 < MIN_INTERVALS) return null;
  const gaps: number[] = [];
  for (let i = newestFirst.length - 1; i > 0; i--) {
    const [older, newer] = [newestFirst[i], newestFirst[i - 1]];
    if (older && newer) gaps.push(daysBetween(older, newer));
  }
  const every_days = median(gaps);
  if (every_days <= 0) return null;
  return { every_days, spread_days: median(gaps.map((g) => Math.abs(g - every_days))) };
}

/** Same shape as a routine's: how much we have seen, tempered by how regular it is. */
function confidenceOf(intervals: number, cycle: { every_days: number; spread_days: number }): number {
  const evidence = Math.min(1, intervals / FULL_EVIDENCE);
  const regularity = Math.max(0, 1 - cycle.spread_days / cycle.every_days);
  return round2(evidence * (0.5 + 0.5 * regularity));
}

function isoMinus(isoDate: string, days: number): string {
  return new Date(Date.parse(`${isoDate}T00:00:00Z`) - days * DAY_MS).toISOString().slice(0, 10);
}
