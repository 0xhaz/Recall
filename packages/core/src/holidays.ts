/**
 * US federal holidays for 2026.
 *
 * Where a holiday falls at a weekend the federal government observes it on the nearest weekday, and
 * both dates are listed: the observed day is when people are actually at home, and the real one is
 * when they celebrate. In 2026 that applies to Independence Day, which is a Saturday.
 */
const HOLIDAYS_2026: readonly [date: string, name: string, festive: boolean][] = [
  ['2026-01-01', "New Year's Day", true],
  ['2026-01-19', 'Martin Luther King Jr. Day', false],
  ['2026-02-16', "Presidents' Day", false],
  ['2026-05-25', 'Memorial Day', false],
  ['2026-06-19', 'Juneteenth', false],
  ['2026-07-03', 'Independence Day (observed)', true],
  ['2026-07-04', 'Independence Day', true],
  ['2026-09-07', 'Labor Day', false],
  ['2026-10-12', 'Columbus Day', false],
  ['2026-11-11', 'Veterans Day', false],
  ['2026-11-26', 'Thanksgiving', true],
  ['2026-12-25', 'Christmas Day', true],
];

/** Days a missed routine isn't counted against. */
export const US_HOLIDAYS_2026: ReadonlySet<string> = new Set(HOLIDAYS_2026.map(([date]) => date));

/** Every holiday by date, named. A date worth confirming an order against, festive or not. */
export const US_HOLIDAY_NAMES_2026: ReadonlyMap<string, string> = new Map(
  HOLIDAYS_2026.map(([date, name]) => [date, name.replace(' (observed)', '')]),
);

/** Celebrations that make a festive context (playlist bias only, never an action on their own). */
export const US_FESTIVALS_2026: ReadonlyMap<string, string> = new Map(
  HOLIDAYS_2026.filter(([, , festive]) => festive).map(([date, name]) => [date, name.replace(' (observed)', '')]),
);
