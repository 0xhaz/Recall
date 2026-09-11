/**
 * Malaysian public holidays for 2026. Fixed-date holidays are exact. Lunar holidays are the
 * expected dates and must be checked against the official gazette; some are state-specific.
 */
const HOLIDAYS_2026: readonly [date: string, name: string, festive: boolean][] = [
  ['2026-01-01', "New Year's Day", true],
  ['2026-02-01', 'Federal Territory Day / Thaipusam (expected)', false],
  ['2026-02-17', 'Chinese New Year (expected)', true],
  ['2026-02-18', 'Chinese New Year (expected)', true],
  ['2026-03-21', 'Hari Raya Aidilfitri (expected)', true],
  ['2026-03-22', 'Hari Raya Aidilfitri (expected)', true],
  ['2026-05-01', 'Labour Day', false],
  ['2026-05-27', 'Hari Raya Haji (expected)', true],
  ['2026-05-31', 'Wesak Day (expected)', true],
  ['2026-06-01', "Agong's Birthday", false],
  ['2026-06-17', 'Awal Muharram (expected)', false],
  ['2026-08-26', 'Maulidur Rasul (expected)', false],
  ['2026-08-31', 'National Day', false],
  ['2026-09-16', 'Malaysia Day', false],
  ['2026-11-08', 'Deepavali (expected)', true],
  ['2026-12-25', 'Christmas Day', true],
];

/** Days a missed routine isn't counted against. */
export const MALAYSIA_HOLIDAYS_2026: ReadonlySet<string> = new Set(HOLIDAYS_2026.map(([date]) => date));

/** Celebrations that make a festive context (playlist bias only, never an action on their own). */
export const MALAYSIA_FESTIVALS_2026: ReadonlyMap<string, string> = new Map(
  HOLIDAYS_2026.filter(([, , festive]) => festive).map(([date, name]) => [date, name.replace(' (expected)', '')]),
);
