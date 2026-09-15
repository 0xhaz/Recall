import { describe, expect, it } from 'vitest';
import { daysBetween, mineRepurchases, normaliseItem, type PastPurchase, statedCadence } from './repurchase.js';

const buy = (label: string, local_date: string, extra: Partial<PastPurchase> = {}): PastPurchase => ({
  action_id: `a-${label}-${local_date}`,
  person_id: null,
  label,
  venue: 'Chewy',
  amount: 24,
  local_date,
  ...extra,
});

const TODAY = '2026-09-15';

describe('normaliseItem', () => {
  it('sees through pack sizes and quantities', () => {
    expect(normaliseItem('12 x Wet Food Pouches')).toBe('wet food pouches');
    expect(normaliseItem('Wet food pouches (12 pack)')).toBe('wet food pouches');
    expect(normaliseItem('wet food pouches x12')).toBe('wet food pouches');
    expect(normaliseItem('500g Wet Food Pouches')).toBe('wet food pouches');
  });

  it('keeps a number that is part of the name', () => {
    // Stripping this would merge omega 3 with every other capsule in the cupboard.
    expect(normaliseItem('Omega 3 capsules')).toBe('omega 3 capsules');
  });

  it('never merges two items that differ in words', () => {
    expect(normaliseItem('dry cat food')).not.toBe(normaliseItem('wet cat food'));
  });
});

describe('statedCadence', () => {
  it('reads a cycle out of the way people actually say it', () => {
    expect(statedCadence('I buy wet food every week')).toEqual({ item: 'wet food', every_days: 7 });
    expect(statedCadence('We replace the water filter every 3 months')).toEqual({
      item: 'water filter',
      every_days: 90,
    });
    expect(statedCadence('I order cat litter monthly')).toEqual({ item: 'cat litter', every_days: 30 });
    expect(statedCadence('I get the smoke alarm batteries every other year')).toEqual({
      item: 'smoke alarm batteries',
      every_days: 730,
    });
  });

  it('returns null rather than inventing an item', () => {
    expect(statedCadence('Alice is vegetarian')).toBeNull();
    expect(statedCadence('I buy wet food')).toBeNull();
    expect(statedCadence('every week')).toBeNull();
  });
});

describe('mineRepurchases', () => {
  it('finds a weekly cycle and says when it is next due', () => {
    const items = mineRepurchases(
      [buy('wet food', '2026-09-11'), buy('wet food', '2026-09-04'), buy('wet food', '2026-08-28')],
      [],
      { today: TODAY },
    );
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      item: 'wet food',
      every_days: 7,
      source: 'mined',
      bought: 3,
      last_date: '2026-09-11',
      last_venue: 'Chewy',
      due_in_days: 3,
      due: false,
    });
  });

  it('flags an overdue item and sorts it first', () => {
    const items = mineRepurchases(
      [
        buy('wet food', '2026-09-01'),
        buy('wet food', '2026-08-25'),
        buy('wet food', '2026-08-18'),
        buy('coffee beans', '2026-09-13'),
        buy('coffee beans', '2026-08-30'),
        buy('coffee beans', '2026-08-16'),
      ],
      [],
      { today: TODAY },
    );
    expect(items.map((i) => i.item)).toEqual(['wet food', 'coffee beans']);
    expect(items[0]).toMatchObject({ due: true, due_in_days: -7 });
    expect(items[1]).toMatchObject({ every_days: 14, due: false });
  });

  it('will not claim a cycle from two purchases', () => {
    expect(
      mineRepurchases([buy('wet food', '2026-09-08'), buy('wet food', '2026-09-01')], [], { today: TODAY }),
    ).toEqual([]);
  });

  it('is less sure when the gaps are all over the place', () => {
    const steady = mineRepurchases(
      [
        buy('wet food', '2026-09-11'),
        buy('wet food', '2026-09-04'),
        buy('wet food', '2026-08-28'),
        buy('wet food', '2026-08-21'),
        buy('wet food', '2026-08-14'),
      ],
      [],
      { today: TODAY },
    );
    const erratic = mineRepurchases(
      [
        buy('tonic water', '2026-09-11'),
        buy('tonic water', '2026-09-09'),
        buy('tonic water', '2026-08-20'),
        buy('tonic water', '2026-08-17'),
        buy('tonic water', '2026-07-02'),
      ],
      [],
      { today: TODAY },
    );
    expect(steady[0]?.confidence).toBe(1);
    expect(erratic[0]?.confidence).toBeLessThan(0.6);
  });

  it('drops something they have clearly stopped buying', () => {
    const items = mineRepurchases(
      [buy('wet food', '2026-05-01'), buy('wet food', '2026-04-24'), buy('wet food', '2026-04-17')],
      [],
      { today: TODAY },
    );
    expect(items).toEqual([]);
  });

  it('counts two rows on the same day as one shop', () => {
    const items = mineRepurchases(
      [
        buy('wet food', '2026-09-11'),
        buy('12 x wet food', '2026-09-11'),
        buy('wet food', '2026-09-04'),
        buy('wet food', '2026-08-28'),
      ],
      [],
      { today: TODAY },
    );
    expect(items[0]).toMatchObject({ bought: 3, every_days: 7 });
  });

  it("lets the person's own words beat the arithmetic, and quotes them", () => {
    const history = [buy('wet food', '2026-09-11'), buy('wet food', '2026-09-04'), buy('wet food', '2026-08-28')];
    const [item] = mineRepurchases(
      history,
      [{ item: 'wet food', every_days: 14, fact_id: 'f1', text: 'I buy wet food every fortnight' }],
      { today: TODAY },
    );
    expect(item).toMatchObject({
      every_days: 14,
      source: 'stated',
      said: { fact_id: 'f1', text: 'I buy wet food every fortnight' },
      due_in_days: 10,
    });
  });

  it('lists a stated item never bought through Recall, but will not call it due', () => {
    const [item] = mineRepurchases(
      [],
      [{ item: 'water filter', every_days: 90, fact_id: 'f2', text: 'I replace the water filter every 3 months' }],
      { today: TODAY },
    );
    // We know how often they replace it, not when they last did: listed, never claimed to be due.
    expect(item).toMatchObject({ item: 'water filter', bought: 0, due: false, due_in_days: null, source: 'stated' });
  });

  it('turns one purchase plus one sentence into a working reminder', () => {
    // Nothing is mineable from a single purchase. Said out loud, that purchase becomes a start date.
    const [item] = mineRepurchases(
      [buy('fridge water filter', '2026-06-07', { venue: 'Home Depot' })],
      [
        {
          item: 'fridge water filter',
          every_days: 90,
          fact_id: 'f3',
          text: 'We replace the fridge water filter every 3 months',
        },
      ],
      { today: TODAY },
    );
    expect(item).toMatchObject({ bought: 1, every_days: 90, due_in_days: -10, due: true, last_venue: 'Home Depot' });
  });

  it('keeps a quarterly item that a short window would have lost', () => {
    const items = mineRepurchases(
      [buy('water filter', '2026-08-20'), buy('water filter', '2026-05-22'), buy('water filter', '2026-02-21')],
      [],
      { today: TODAY },
    );
    expect(items[0]).toMatchObject({ every_days: 90, bought: 3 });
  });
});

describe('daysBetween', () => {
  it('counts calendar days across a month boundary', () => {
    expect(daysBetween('2026-08-28', '2026-09-04')).toBe(7);
    expect(daysBetween('2026-09-15', '2026-09-15')).toBe(0);
  });
});
