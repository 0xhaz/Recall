import { describe, expect, it } from 'vitest';
import { temporalStamp } from './temporal.js';

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
