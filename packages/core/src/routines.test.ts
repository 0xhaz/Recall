import { describe, expect, it } from 'vitest';
import { formatMinute, mineRoutines, type Occurrence } from './routines.js';
import { addDays } from './temporal.js';

const TODAY = '2026-09-28'; // a Monday
const JITTER = [-6, 4, 0, 8, -3, 5, -8, 2, 6, -4, 1, -2, 7, -5, 3, 0, -7, 4, -1, 5, -3];

/** The 21 days before TODAY, oldest first. */
const DAYS = Array.from({ length: 21 }, (_, i) => addDays(TODAY, i - 21));
const weekend = (d: string) => [0, 6].includes(new Date(`${d}T00:00:00Z`).getUTCDay());

const at = (person: string, kind: string, date: string, minute: number, ok = true): Occurrence => ({
  person_id: person,
  kind,
  local_date: date,
  local_minute: minute,
  ok,
});

function morning(extra: (date: string, i: number) => Occurrence[] = () => []): Occurrence[] {
  return DAYS.flatMap((date, i) =>
    weekend(date)
      ? [at('alice', 'brunch.order', date, 630 + (JITTER[i] ?? 0))]
      : [
          at('alice', 'coffee_machine.start', date, 430 + (JITTER[i] ?? 0)),
          at('alice', 'media.play', date, 445 + (JITTER[i] ?? 0)),
          ...extra(date, i),
        ],
  );
}

const find = (routines: ReturnType<typeof mineRoutines>, kind: string) => routines.find((r) => r.kind === kind);

describe('mineRoutines', () => {
  it('finds a weekday coffee at 07:10, what follows it, and a weekend habit', () => {
    const routines = mineRoutines(morning(), { today: TODAY });
    const coffee = find(routines, 'coffee_machine.start');
    expect(coffee).toMatchObject({ days: 'weekdays', support: 1, health: 'ok', sequence: ['media.play'] });
    expect(formatMinute(coffee?.center_minute ?? 0)).toBe('07:10');
    expect(coffee?.spread_minutes).toBeLessThanOrEqual(12);
    expect(find(routines, 'brunch.order')).toMatchObject({ days: 'weekends', support: 1 });
  });

  it("doesn't count a public holiday as a missed day", () => {
    const skipHoliday = morning().filter((o) => o.local_date !== '2026-09-16');
    const without = find(mineRoutines(skipHoliday, { today: TODAY }), 'coffee_machine.start');
    const withHolidays = find(
      mineRoutines(skipHoliday, { today: TODAY, holidays: new Set(['2026-09-16']) }),
      'coffee_machine.start',
    );
    expect(without?.support).toBeLessThan(1);
    expect(withHolidays?.support).toBe(1);
  });

  it('ignores things that happened on too few days', () => {
    const noise = [
      at('alice', 'lights.garage.on', DAYS[3] ?? '', 1320),
      at('alice', 'lights.garage.on', DAYS[9] ?? '', 1325),
    ];
    expect(find(mineRoutines([...morning(), ...noise], { today: TODAY }), 'lights.garage.on')).toBeUndefined();
  });

  it('follows a usual time that drifts, and says where it used to be', () => {
    const drifting = DAYS.filter((d) => !weekend(d)).map((date, i, all) => {
      const late = i >= all.length - 5;
      return at(
        'alice',
        'coffee_machine.start',
        date,
        late ? 450 + (i - (all.length - 5)) * 5 : 430 + (JITTER[i] ?? 0) / 2,
      );
    });
    const coffee = find(mineRoutines(drifting, { today: TODAY }), 'coffee_machine.start');
    expect(coffee?.shifted_from).not.toBeNull();
    expect(coffee?.center_minute).toBeGreaterThan(450);
  });

  it('tells a broken routine (the last attempts failed) from a fading one (it stopped happening)', () => {
    const weekdays = DAYS.filter((d) => !weekend(d));
    const lastTwo = new Set(weekdays.slice(-2));
    const failing = weekdays.map((d, i) =>
      at('alice', 'coffee_machine.start', d, 430 + (JITTER[i] ?? 0), !lastTwo.has(d)),
    );
    expect(find(mineRoutines(failing, { today: TODAY }), 'coffee_machine.start')).toMatchObject({
      health: 'broken',
      health_reason: 'the last 2 attempts failed',
    });

    const stopped = weekdays
      .filter((d) => d < addDays(TODAY, -7))
      .map((d, i) => at('alice', 'coffee_machine.start', d, 430 + (JITTER[i] ?? 0)));
    const fading = find(
      mineRoutines([...stopped, at('alice', 'other.thing', addDays(TODAY, -1), 600)], { today: TODAY }),
      'coffee_machine.start',
    );
    expect(fading?.health).toBe('fading');
    expect(fading?.confidence).toBeLessThan(0.7);
  });

  it('keeps people apart', () => {
    const routines = mineRoutines(
      [...morning(), ...DAYS.map((d, i) => at('bob', 'coffee_machine.start', d, 540 + (JITTER[i] ?? 0)))],
      { today: TODAY },
    );
    const coffees = routines.filter((r) => r.kind === 'coffee_machine.start');
    expect(coffees.map((r) => [r.person_id, r.days, formatMinute(r.center_minute)])).toEqual([
      ['alice', 'weekdays', '07:10'],
      ['bob', 'daily', '09:00'],
    ]);
  });
});
