import { describe, expect, it } from 'vitest';
import { addDays, isIsoDate, resolveEnd, temporalStamp } from './temporal.js';

describe('temporalStamp', () => {
  const instant = new Date('2026-09-11T16:30:05Z');

  it('renders the device-local date and time, not UTC', () => {
    const stamp = temporalStamp('Asia/Kuala_Lumpur', instant);
    expect(stamp).toEqual({
      local_date: '2026-09-12',
      local_time: '00:30:05',
      weekday: 'Saturday',
      timezone: 'Asia/Kuala_Lumpur',
      utc_offset: '+08:00',
      iso_utc: '2026-09-11T16:30:05.000Z',
    });
  });

  it('handles negative offsets and UTC', () => {
    expect(temporalStamp('America/Los_Angeles', instant).utc_offset).toBe('-07:00');
    expect(temporalStamp('UTC', instant).utc_offset).toBe('+00:00');
  });
});

describe('calendar helpers', () => {
  it('adds days across month and year ends', () => {
    expect(addDays('2026-12-30', 3)).toBe('2027-01-02');
    expect(addDays('2026-09-11', 0)).toBe('2026-09-11');
  });

  it('rejects impossible dates', () => {
    expect(isIsoDate('2026-09-16')).toBe(true);
    expect(isIsoDate('2026-02-31')).toBe(false);
    expect(isIsoDate('next Friday')).toBe(false);
  });
});

describe('resolveEnd', () => {
  const friday = '2026-09-11';

  it.each([
    ['Wednesday', '2026-09-16'],
    ['until wednesday', '2026-09-16'],
    ['next Wednesday', '2026-09-16'],
    ['Friday', '2026-09-18'],
    ['this week', '2026-09-13'],
    ['the end of the week', '2026-09-13'],
    ['this weekend', '2026-09-13'],
    ['next week', '2026-09-20'],
    ['tomorrow', '2026-09-12'],
    ['tonight', '2026-09-11'],
    ['this month', '2026-09-30'],
    ['in 3 days', '2026-09-14'],
    ['a few days', '2026-09-14'],
    ['a couple of days', '2026-09-13'],
    ['for two weeks', '2026-09-25'],
    ['a week', '2026-09-18'],
    ['2026-10-01', '2026-10-01'],
  ])('%s → %s', (phrase, expected) => {
    expect(resolveEnd(phrase, friday)).toBe(expected);
  });

  it.each([['soon'], ['next month'], ['2026-09-01'], [''], [null]])('does not guess: %s', (phrase) => {
    expect(resolveEnd(phrase, friday)).toBeNull();
  });
});
