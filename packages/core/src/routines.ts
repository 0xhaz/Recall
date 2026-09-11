import { addDays } from './temporal.js';

// Routines (architecture.md §2): procedural memory mined from what actually happened in the house,
// never inferred by a model. Pure, so the same history always gives the same routines.

export type DayPattern = 'daily' | 'weekdays' | 'weekends';

export interface Occurrence {
  person_id: string | null;
  kind: string;
  /** Household-local date (YYYY-MM-DD) and minute of the day (0–1439). */
  local_date: string;
  local_minute: number;
  /** false when the device reported that the action failed. */
  ok: boolean;
}

export interface MinedRoutine {
  person_id: string | null;
  kind: string;
  days: DayPattern;
  center_minute: number;
  spread_minutes: number;
  /** Share of eligible days on which it happened (holidays excluded). */
  support: number;
  confidence: number;
  last_seen: string;
  /** Set when the usual time has moved lately: where it used to be. */
  shifted_from: number | null;
  health: 'ok' | 'fading' | 'broken';
  health_reason: string | null;
  /** What usually follows it, in order (coffee → news). */
  sequence: string[];
}

export interface MineOptions {
  today: string;
  windowDays?: number;
  holidays?: ReadonlySet<string>;
  minSupport?: number;
}

const CLUSTER_GAP_MIN = 20;
const MIN_DAYS = 3;
const RECENT_DAYS = 7;
const DRIFT_MIN = 20;
const NEAR_MIN = 60;
const CHAIN_GAP_MIN = 45;
const CHAIN_WITHIN_MIN = 60;
const CHAIN_SUPPORT = 0.6;
const DECAY_DAYS = 14;

export function isWeekend(isoDate: string): boolean {
  const day = new Date(`${isoDate}T00:00:00Z`).getUTCDay();
  return day === 0 || day === 6;
}

export function dayMatches(days: DayPattern, isoDate: string): boolean {
  return days === 'daily' || (days === 'weekends') === isWeekend(isoDate);
}

export function formatMinute(minute: number): string {
  return `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? (sorted[mid] ?? 0) : Math.round(((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2);
}

function dateRange(from: string, to: string): string[] {
  const days: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) days.push(d);
  return days;
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** Group times of day into clusters, splitting wherever consecutive times are more than 20 minutes apart. */
function clusterByTime(occurrences: readonly Occurrence[]): Occurrence[][] {
  const sorted = [...occurrences].sort((a, b) => a.local_minute - b.local_minute);
  const clusters: Occurrence[][] = [];
  let current: Occurrence[] = [];
  for (const o of sorted) {
    const last = current.at(-1);
    if (last && o.local_minute - last.local_minute > CLUSTER_GAP_MIN) {
      clusters.push(current);
      current = [];
    }
    current.push(o);
  }
  if (current.length) clusters.push(current);
  return clusters.filter((c) => new Set(c.map((o) => o.local_date)).size >= MIN_DAYS);
}

interface Context {
  days: string[];
  recentStart: string;
  today: string;
  minSupport: number;
}

function describe(
  cluster: readonly Occurrence[],
  group: readonly Occurrence[],
  ctx: Context,
): { routine: MinedRoutine; byDay: Map<string, number> } | null {
  // One time per day: the first time it happened that day.
  const byDay = new Map<string, number>();
  for (const o of cluster) {
    const seen = byDay.get(o.local_date);
    if (seen === undefined || o.local_minute < seen) byDay.set(o.local_date, o.local_minute);
  }
  const dates = [...byDay.keys()];
  const share = (pool: string[]) => (pool.length ? dates.filter((d) => pool.includes(d)).length / pool.length : 0);
  const weekdays = share(ctx.days.filter((d) => !isWeekend(d)));
  const weekends = share(ctx.days.filter(isWeekend));

  let days: DayPattern;
  let support: number;
  if (weekdays >= ctx.minSupport && weekends >= ctx.minSupport) {
    days = 'daily';
    support = share(ctx.days);
  } else if (weekdays >= ctx.minSupport) {
    days = 'weekdays';
    support = weekdays;
  } else if (weekends >= ctx.minSupport) {
    days = 'weekends';
    support = weekends;
  } else {
    return null;
  }

  const minutes = [...byDay.values()];
  let center = median(minutes);
  const spread = Math.max(5, Math.round(1.4826 * median(minutes.map((m) => Math.abs(m - center)))));

  // Habits drift: if the last week clearly moved, follow it rather than raise an alarm.
  let shiftedFrom: number | null = null;
  const recent = [...byDay].filter(([d]) => d >= ctx.recentStart);
  if (recent.length >= 3) {
    const recentCenter = median(recent.map(([, m]) => m));
    if (Math.abs(recentCenter - center) > DRIFT_MIN) {
      shiftedFrom = center;
      center = recentCenter;
    }
  }

  // Broken ("the action started failing") versus fading ("they stopped doing it").
  const attempts = group
    .filter((o) => Math.abs(o.local_minute - center) <= NEAR_MIN)
    .sort((a, b) => a.local_date.localeCompare(b.local_date) || a.local_minute - b.local_minute);
  let trailingFailures = 0;
  for (let i = attempts.length - 1; i >= 0 && attempts[i]?.ok === false; i--) trailingFailures++;
  const recentPool = ctx.days.filter((d) => d >= ctx.recentStart && dayMatches(days, d));
  let health: MinedRoutine['health'] = 'ok';
  let healthReason: string | null = null;
  if (trailingFailures >= 2) {
    health = 'broken';
    healthReason = `the last ${trailingFailures} attempts failed`;
  } else if (recentPool.length >= 3 && recent.length / recentPool.length < support / 2) {
    health = 'fading';
    healthReason = 'happening less often lately';
  }

  const lastSeen = dates.reduce((a, b) => (a > b ? a : b));
  const consistency = Math.max(0, 1 - spread / 60);
  const staleness = Math.max(0, daysBetween(lastSeen, ctx.today) - 1);
  const confidence = Math.round(support * (0.5 + 0.5 * consistency) * Math.exp(-staleness / DECAY_DAYS) * 100) / 100;

  const first = cluster[0];
  if (!first) return null;
  return {
    routine: {
      person_id: first.person_id,
      kind: first.kind,
      days,
      center_minute: center,
      spread_minutes: spread,
      support: Math.round(Math.min(1, support) * 100) / 100,
      confidence,
      last_seen: lastSeen,
      shifted_from: shiftedFrom,
      health,
      health_reason: healthReason,
      sequence: [],
    },
    byDay,
  };
}

/** A → B when B usually follows A within the hour on the same days: wake → lights → coffee → news. */
function linkSequences(found: { routine: MinedRoutine; byDay: Map<string, number> }[]): void {
  const next = new Map<MinedRoutine, MinedRoutine>();
  const groups = new Map<string, typeof found>();
  for (const f of found) {
    const key = `${f.routine.person_id ?? ''}|${f.routine.days}`;
    groups.set(key, [...(groups.get(key) ?? []), f]);
  }
  for (const list of groups.values()) {
    list.sort((a, b) => a.routine.center_minute - b.routine.center_minute);
    for (let i = 0; i + 1 < list.length; i++) {
      const a = list[i];
      const b = list[i + 1];
      if (!a || !b) continue;
      const gap = b.routine.center_minute - a.routine.center_minute;
      if (gap <= 0 || gap > CHAIN_GAP_MIN) continue;
      let together = 0;
      for (const [date, minute] of a.byDay) {
        const after = b.byDay.get(date);
        if (after !== undefined && after > minute && after - minute <= CHAIN_WITHIN_MIN) together++;
      }
      if (together / a.byDay.size >= CHAIN_SUPPORT) next.set(a.routine, b.routine);
    }
  }
  const followers = new Set(next.values());
  for (const { routine } of found) {
    if (followers.has(routine)) continue;
    const sequence: string[] = [];
    for (let step = next.get(routine); step && sequence.length < 5; step = next.get(step)) sequence.push(step.kind);
    routine.sequence = sequence;
  }
}

export function mineRoutines(occurrences: readonly Occurrence[], opts: MineOptions): MinedRoutine[] {
  const holidays = opts.holidays ?? new Set<string>();
  const yesterday = addDays(opts.today, -1);
  const from = addDays(opts.today, -(opts.windowDays ?? 28));
  const usable = occurrences.filter(
    (o) => o.local_date >= from && o.local_date <= yesterday && !holidays.has(o.local_date),
  );
  if (usable.length === 0) return [];

  // Days before the first recorded activity don't count against anything.
  const firstDay = usable.reduce((min, o) => (o.local_date < min ? o.local_date : min), yesterday);
  const ctx: Context = {
    days: dateRange(firstDay, yesterday).filter((d) => !holidays.has(d)),
    recentStart: addDays(opts.today, -RECENT_DAYS),
    today: opts.today,
    minSupport: opts.minSupport ?? 0.5,
  };

  const groups = new Map<string, Occurrence[]>();
  for (const o of usable) {
    const key = `${o.person_id ?? ''}|${o.kind}`;
    groups.set(key, [...(groups.get(key) ?? []), o]);
  }

  const found: { routine: MinedRoutine; byDay: Map<string, number> }[] = [];
  for (const group of groups.values()) {
    for (const cluster of clusterByTime(group.filter((o) => o.ok))) {
      const described = describe(cluster, group, ctx);
      if (described) found.push(described);
    }
  }
  linkSequences(found);
  return found
    .map((f) => f.routine)
    .sort((a, b) => (a.person_id ?? '').localeCompare(b.person_id ?? '') || a.center_minute - b.center_minute);
}
