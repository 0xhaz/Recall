import { isWeekend, parseHlc, temporalStamp } from '@recall/core';
import { describe, expect, it } from 'vitest';
import type { RecallApi } from './recall.js';
import { expandHistory, expandLive, type HistoryReplay, type LiveReplay, runReplay } from './replay.js';

const TZ = 'America/New_York';
const NOW = new Date('2026-10-05T04:00:00Z'); // Monday 12:00 in Brooklyn

const coffee: HistoryReplay = {
  name: 'coffee',
  description: 'test',
  mode: 'history',
  days: 21,
  daily: [
    {
      device: 'kitchen-echo',
      kind: 'coffee_machine.start',
      person: 'Emma',
      time: '07:10',
      jitter_min: 8,
      weekdays_only: true,
      failed_last: 2,
    },
    { device: 'bedroom-echo', kind: 'checkin.morning', person: 'Ruth', time: '07:30', last_days: 14 },
  ],
};

describe('expandHistory', () => {
  it('lays weekday routines into the past days, around the usual time, with the last ones failing', () => {
    const events = expandHistory(coffee, TZ, NOW);
    const coffees = events.filter((e) => e.kind === 'coffee_machine.start');
    expect(coffees).toHaveLength(15);
    for (const e of coffees) {
      const local = temporalStamp(TZ, e.at);
      expect(isWeekend(local.local_date)).toBe(false);
      const [h = 0, m = 0] = local.local_time.split(':').map(Number);
      expect(Math.abs(h * 60 + m - 430)).toBeLessThanOrEqual(8);
    }
    expect(
      coffees.filter((e) => e.payload?.status === 'failed').map((e) => temporalStamp(TZ, e.at).local_date),
    ).toEqual(['2026-10-01', '2026-10-02']);
    expect(events.filter((e) => e.kind === 'checkin.morning')).toHaveLength(14);
    expect(events.every((e) => e.at < NOW)).toBe(true);
  });

  it('is the same every time', () => {
    expect(expandHistory(coffee, TZ, NOW).map((e) => e.at.getTime())).toEqual(
      expandHistory(coffee, TZ, NOW).map((e) => e.at.getTime()),
    );
  });
});

describe('expandLive', () => {
  it('turns a recorded series into timed readings, in order with the one-off events', () => {
    const run: LiveReplay = {
      name: 'run',
      description: 'test',
      mode: 'live',
      events: [{ at_s: 7, device: 'phone', kind: 'phone.charging', payload: { charging: true } }],
      series: [{ device: 'watch', kind: 'hr.sample', person: 'Emma', field: 'bpm', every_s: 5, values: [80, 120] }],
    };
    expect(expandLive(run)).toEqual([
      { device: 'watch', kind: 'hr.sample', person: 'Emma', payload: { bpm: 80 }, at_s: 0 },
      { device: 'watch', kind: 'hr.sample', person: 'Emma', payload: { bpm: 120 }, at_s: 5 },
      { at_s: 7, device: 'phone', kind: 'phone.charging', payload: { charging: true } },
    ]);
  });
});

describe('runReplay', () => {
  it('sends history through ingest_events per device, stamped when each thing happened', async () => {
    const sent: { device: { id: string }; events: { hlc: string; kind: string }[] }[] = [];
    const recall: RecallApi = {
      tools: async () => [],
      call: async <T>(_name: string, args: Record<string, unknown>) => {
        const batch = args as unknown as (typeof sent)[number];
        sent.push(batch);
        return { accepted: batch.events.length } as T;
      },
    };
    const { sent: accepted } = await runReplay(coffee, recall, { timezone: TZ, now: NOW });
    expect(accepted).toBe(29);
    expect(sent.map((b) => b.device.id).sort()).toEqual(['bedroom-echo', 'kitchen-echo']);
    const first = sent.find((b) => b.device.id === 'kitchen-echo')?.events[0];
    expect(parseHlc(first?.hlc ?? '')?.wall).toBeLessThan(NOW.getTime());
  });
});
