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
