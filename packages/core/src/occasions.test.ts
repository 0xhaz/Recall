import { describe, expect, it } from 'vitest';
import { holidayDates, type ImportantDate, occasionIn, occasionsFor } from './occasions.js';

describe('occasionIn', () => {
  it('reads a birthday or anniversary out of the way people say it', () => {
    expect(occasionIn("Sofia's birthday is March 3", 2026)).toEqual({ name: "Sofia's birthday", date: '2026-03-03' });
    expect(occasionIn("Sofia's birthday is on the 3rd of March", 2026)).toEqual({
      name: "Sofia's birthday",
      date: '2026-03-03',
    });
    expect(occasionIn('Our anniversary is June 12', 2026)).toEqual({ name: 'anniversary', date: '2026-06-12' });
    expect(occasionIn("Daniel's mum's birthday is 8 Dec", 2026)).toEqual({
      name: "Daniel's mum's birthday",
      date: '2026-12-08',
    });
  });

  it('returns null rather than guessing a date it did not find', () => {
    expect(occasionIn('Emma is vegetarian', 2026)).toBeNull();
    expect(occasionIn("Sofia's birthday is coming up", 2026)).toBeNull();
    expect(occasionIn("Sofia's birthday is Marchtober 3", 2026)).toBeNull();
    expect(occasionIn("Sofia's birthday is March 99", 2026)).toBeNull();
  });
});

describe('occasionsFor', () => {
  const dates: ImportantDate[] = [
    { date: '2026-11-26', name: 'Thanksgiving' },
    { date: '2026-03-03', name: "Sofia's birthday", fact_id: 'f1' },
  ];

  it('stops for an order placed on the day itself', () => {
    expect(occasionsFor(dates, '2026-11-26', 'Order dinner').map((d) => d.name)).toEqual(['Thanksgiving']);
  });

  it('stops when the request names the occasion within the lead time', () => {
    expect(occasionsFor(dates, '2026-02-28', "a cake for Sofia's birthday").map((d) => d.name)).toEqual([
      "Sofia's birthday",
    ]);
  });

  it('stays quiet for an ordinary order near a holiday', () => {
    // The r/alexa complaint about custom actions is that they fire on anything nearby. Proximity
    // alone is not a reason to interrupt: every grocery run in late November would confirm.
    expect(occasionsFor(dates, '2026-11-23', 'Order the usual wet food')).toEqual([]);
  });

  it('will not reach back to an occasion that has already passed', () => {
    expect(occasionsFor(dates, '2026-03-05', "flowers for Sofia's birthday")).toEqual([]);
  });

  it('will not reach forward past the lead time', () => {
    expect(occasionsFor(dates, '2026-02-20', "a cake for Sofia's birthday")).toEqual([]);
  });
});

describe('holidayDates', () => {
  it('names the dates it has, and is silent about years it does not', () => {
    const found = holidayDates(2026);
    expect(found.find((d) => d.date === '2026-11-26')?.name).toBe('Thanksgiving');
    expect(found.find((d) => d.date === '2026-07-03')?.name).toBe('Independence Day');
    expect(holidayDates(2027)).toEqual([]);
  });
});
