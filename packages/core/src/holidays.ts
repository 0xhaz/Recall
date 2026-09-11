/**
 * Malaysian public holidays for 2026, so a missed routine on a holiday isn't counted against it.
 * Fixed-date holidays are exact. Lunar holidays are the expected dates and must be checked against
 * the official gazette before relying on them; some are state-specific.
 */
export const MALAYSIA_HOLIDAYS_2026: ReadonlySet<string> = new Set([
  '2026-01-01', // New Year's Day (most states)
  '2026-02-01', // Federal Territory Day; Thaipusam (expected)
  '2026-02-17', // Chinese New Year (expected)
  '2026-02-18', // Chinese New Year, second day (expected)
  '2026-03-21', // Hari Raya Aidilfitri (expected)
  '2026-03-22', // Hari Raya Aidilfitri, second day (expected)
  '2026-05-01', // Labour Day
  '2026-05-27', // Hari Raya Haji (expected)
  '2026-05-31', // Wesak Day (expected)
  '2026-06-01', // Birthday of the Yang di-Pertuan Agong
  '2026-06-17', // Awal Muharram (expected)
  '2026-08-26', // Maulidur Rasul (expected)
  '2026-08-31', // National Day
  '2026-09-16', // Malaysia Day
  '2026-11-08', // Deepavali (expected)
  '2026-12-25', // Christmas Day
]);
