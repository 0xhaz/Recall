// Dates worth stopping for (design.md §1.1, §3.2): a holiday, or a birthday or anniversary the
// household has told us about. Getting an order wrong on an ordinary Tuesday is a nuisance; getting
// it wrong on someone's birthday is the thing people actually remember, so the order is read back
// and confirmed rather than simply placed.
//
// The trigger is deliberately narrow. r/alexa's standing complaint about custom actions is that they
// fire on anything nearby — a birthday routine going off on unrelated requests — so proximity alone
// is not enough. Either the occasion is named in the request, or the action falls on the day itself.

import { US_HOLIDAY_NAMES_2026 } from './holidays.js';

export interface ImportantDate {
  /** Household-local ISO date, YYYY-MM-DD. */
  date: string;
  /** What to call it out loud: "Thanksgiving", "Sofia's birthday". */
  name: string;
  /** Set when it came from something the household said rather than the calendar. */
  fact_id?: string;
}

/** How far ahead a named occasion still counts: people order for a birthday the week before. */
export const OCCASION_LEAD_DAYS = 7;

const MONTHS: Record<string, number> = {
  january: 1,
  jan: 1,
  february: 2,
  feb: 2,
  march: 3,
  mar: 3,
  april: 4,
  apr: 4,
  may: 5,
  june: 6,
  jun: 6,
  july: 7,
  jul: 7,
  august: 8,
  aug: 8,
  september: 9,
  sept: 9,
  sep: 9,
  october: 10,
  oct: 10,
  november: 11,
  nov: 11,
  december: 12,
  dec: 12,
};

const OCCASION = /\b((?:[\w'’]+\s+){0,2}?)(birthdays?|anniversary)\b/i;
const DAY_MONTH = /\b(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?([A-Za-z]+)\b/;
const MONTH_DAY = /\b([A-Za-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?\b/;
const NOT_A_NAME = new Set(['the', 'a', 'an', 'is', 'on', 'our', 'their', 'and', 'for', 'of', 'this', 'that', 'next']);

const pad = (n: number): string => String(n).padStart(2, '0');

/**
 * Reads a birthday or anniversary out of something the household said, placed in `year`.
 * Null when the text does not state one — it never guesses a date it did not find.
 */
export function occasionIn(text: string, year: number): { name: string; date: string } | null {
  const occasion = OCCASION.exec(text);
  if (!occasion) return null;
  const [, rawName = '', word = ''] = occasion;
  const after = text.slice(occasion.index + occasion[0].length);

  let month: number | undefined;
  let day: number | undefined;
  const dayFirst = DAY_MONTH.exec(after);
  if (dayFirst) {
    month = MONTHS[(dayFirst[2] ?? '').toLowerCase()];
    day = Number(dayFirst[1]);
  }
  if (month === undefined) {
    const monthFirst = MONTH_DAY.exec(after);
    if (monthFirst) {
      month = MONTHS[(monthFirst[1] ?? '').toLowerCase()];
      day = Number(monthFirst[2]);
    }
  }
  if (month === undefined || day === undefined || day < 1 || day > 31) return null;

  const owner = rawName
    .trim()
    .split(/\s+/)
    .filter((w) => w && !NOT_A_NAME.has(w.toLowerCase()))
    .join(' ');
  const noun = word.toLowerCase().replace(/s$/, '');
  return { name: owner ? `${owner} ${noun}` : noun, date: `${year}-${pad(month)}-${pad(day)}` };
}

/** The calendar's own dates for a year, plus whatever the household told us. */
export function holidayDates(year: number): ImportantDate[] {
  if (year !== 2026) return []; // Only 2026 is on record; inventing other years would be worse than silence.
  return [...US_HOLIDAY_NAMES_2026].map(([date, name]) => ({ date, name }));
}

function daysAhead(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

const plain = (s: string): string => s.toLowerCase().replace(/[^\p{L}\p{N}\s]+/gu, ' ');

/** Every word of `name` appears in the text: "Sofia's birthday" in "a cake for Sofia's birthday". */
function named(text: string, name: string): boolean {
  const hay = ` ${plain(text)} `;
  const words = plain(name)
    .split(/\s+/)
    .filter((w) => w.length > 2);
  return words.length > 0 && words.every((w) => hay.includes(` ${w}`));
}

/**
 * Which important dates this action actually touches. Either the request names the occasion and it
 * is within the lead time, or the action happens on the day itself — never mere proximity, which
 * would confirm every grocery order in late November.
 */
export function occasionsFor(
  dates: readonly ImportantDate[],
  on: string,
  said: string,
  leadDays: number = OCCASION_LEAD_DAYS,
): ImportantDate[] {
  return dates.filter((d) => {
    const ahead = daysAhead(on, d.date);
    if (ahead === 0) return true;
    return ahead > 0 && ahead <= leadDays && named(said, d.name);
  });
}
