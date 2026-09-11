import type { TemporalStamp } from './types.js';

/**
 * Build the temporal stamp for a device's timezone, so the assistant never answers
 * "tonight" or "today" from model belief.
 */
export function temporalStamp(timezone: string, now: Date = new Date()): TemporalStamp {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      weekday: 'long',
      hourCycle: 'h23',
      timeZoneName: 'longOffset',
    })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );

  const offset = parts.timeZoneName === 'GMT' ? '+00:00' : String(parts.timeZoneName).replace('GMT', '');

  return {
    local_date: `${parts.year}-${parts.month}-${parts.day}`,
    local_time: `${parts.hour}:${parts.minute}:${parts.second}`,
    weekday: String(parts.weekday),
    timezone,
    utc_offset: offset,
    iso_utc: now.toISOString(),
  };
}

const DAY_MS = 86_400_000;

/** Calendar arithmetic on YYYY-MM-DD dates (UTC, so no DST surprises). */
export function addDays(isoDate: string, days: number): string {
  const start = Date.parse(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(start)) throw new RangeError(`Not a date: ${isoDate}`);
  return new Date(start + days * DAY_MS).toISOString().slice(0, 10);
}

export function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = Date.parse(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed) && new Date(parsed).toISOString().startsWith(value);
}

const WEEKDAYS =
  /^(?:this |next |coming )?(sunday|sun|monday|mon|tuesday|tues|tue|wednesday|wed|thursday|thurs|thur|thu|friday|fri|saturday|sat)$/;
const WEEKDAY_PREFIXES = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const COUNT_WORDS: Record<string, number> = {
  a: 1,
  an: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  few: 3,
  couple: 2,
};

function weekdayIndex(isoDate: string): number {
  return new Date(`${isoDate}T00:00:00Z`).getUTCDay();
}

/**
 * Resolve the speaker's words for when something ends ("Wednesday", "this week", "for two weeks")
 * to the last local date it is still true. Small models get weekday arithmetic wrong, so the
 * extractor asks for the words and the calendar maths happens here. Null when not understood.
 */
export function resolveEnd(phrase: string | null | undefined, today: string): string | null {
  const trimmed = phrase?.trim();
  if (!trimmed) return null;
  if (isIsoDate(trimmed)) return trimmed >= today ? trimmed : null;

  const p = trimmed
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\b(until|till|til|through|by|for|in|over|end of|the)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const dow = weekdayIndex(today);
  const toSunday = (7 - dow) % 7;

  if (p === 'today' || p === 'tonight') return today;
  if (p === 'tomorrow') return addDays(today, 1);
  if (/^(this )?(week|weekend)$/.test(p)) return addDays(today, toSunday);
  if (p === 'next week' || p === 'next weekend') return addDays(today, toSunday + 7);
  if (/^(this )?month$/.test(p)) {
    const next = new Date(`${today.slice(0, 7)}-01T00:00:00Z`);
    next.setUTCMonth(next.getUTCMonth() + 1);
    return addDays(next.toISOString().slice(0, 10), -1);
  }

  const weekday = p.match(WEEKDAYS)?.[1];
  if (weekday) {
    const target = WEEKDAY_PREFIXES.indexOf(weekday.slice(0, 3));
    return addDays(today, (target - dow + 7) % 7 || 7);
  }

  const span = p.match(/^(?:a )?(\d+|an?|one|two|three|four|five|few|couple)(?: of)? (day|week)s?$/);
  if (span?.[1] && span[2]) {
    const n = /^\d+$/.test(span[1]) ? Number(span[1]) : (COUNT_WORDS[span[1]] ?? 0);
    if (n > 0) return addDays(today, n * (span[2] === 'week' ? 7 : 1));
  }
  return null;
}
