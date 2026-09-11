// Routines end to end: device reports become activity, the miner finds usual times and what follows
// them, a failing routine is flagged, and a missed check-in asks the person before the carers hear.
import { randomUUID } from 'node:crypto';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { addDays, formatHlc, formatMinute, MALAYSIA_HOLIDAYS_2026, type SyncEvent, temporalStamp } from '@recall/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AbsenceWatcher } from '../src/routines/absence.service.js';
import { RoutineMiner } from '../src/routines/miner.service.js';
import { callTool, personId, startApp, type TestApp, type TestHousehold } from './support.js';

const TZ = 'Asia/Kuala_Lumpur';
const JITTER = [-6, 4, 0, 8, -3, 5, -8, 2, 6, -4, 1, -2, 7, -5, 3, 0, -7, 4, -1, 5, -3];
const today = temporalStamp(TZ).local_date;

let t: TestApp;
let hh: TestHousehold;
let client: Client;
let counter = 0;
let reported = 0;

const localAt = (date: string, minute: number) => new Date(`${date}T${formatMinute(minute)}:00+08:00`);
const isWeekend = (d: string) => [0, 6].includes(new Date(`${d}T00:00:00Z`).getUTCDay());

function report(date: string, minute: number, kind: string, person: string, device: string, payload = {}) {
  return {
    event_id: randomUUID(),
    hlc: formatHlc({ wall: localAt(date, minute).getTime(), counter: counter++ % 99_999, node: device }),
    kind,
    person,
    payload,
  };
}

beforeAll(async () => {
  t = await startApp();
  hh = await t.createHousehold([
    ['Alice', 'owner'],
    ['Som', 'cared_for'],
    ['Farah', 'caregiver'],
  ]);
  client = await t.mcp(hh.token);

  // Three weeks of mornings: Alice's coffee then the news on weekdays (the last two coffees failed),
  // and two weeks of Som saying good morning around 07:30.
  const past = Array.from({ length: 21 }, (_, i) => addDays(today, i - 21));
  const weekdays = past.filter((d) => !isWeekend(d) && !MALAYSIA_HOLIDAYS_2026.has(d));
  const failed = new Set(weekdays.slice(-2));
  const kitchen = weekdays.flatMap((d, i) => [
    report(
      d,
      430 + (JITTER[i] ?? 0),
      'coffee_machine.start',
      'Alice',
      'kitchen-echo',
      failed.has(d) ? { status: 'failed' } : {},
    ),
    report(d, 445 + (JITTER[i] ?? 0), 'media.play', 'Alice', 'kitchen-echo', { title: 'Morning news' }),
  ]);
  const bedroom = past
    .slice(-14)
    .map((d, i) => report(d, 450 + (JITTER[i] ?? 0), 'checkin.morning', 'Som', 'bedroom-echo'));
  await callTool(client, 'ingest_events', { device: { id: 'kitchen-echo' }, events: kitchen });
  await callTool(client, 'ingest_events', { device: { id: 'bedroom-echo' }, events: bedroom });
  reported = kitchen.length + bedroom.length;
});

afterAll(() => t?.close());

describe('routine miner', () => {
  it('turns device reports into routines: the usual time, what follows, and whether it still works', async () => {
    const { rows: activity } = await t.db.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM activity WHERE household_id = $1',
      [hh.id],
    );
    expect(activity[0]?.n).toBe(reported);

    const report1 = await t.app.get(RoutineMiner).mine(hh.id);
    expect(report1.inserted).toBeGreaterThanOrEqual(3);

    const { rows } = await t.db.query<{
      kind: string;
      person_id: string;
      days: string;
      center_minute: number;
      health: string;
      health_reason: string | null;
      sequence: string[];
    }>(
      'SELECT kind, person_id, days, center_minute, health, health_reason, sequence FROM routine WHERE household_id = $1',
      [hh.id],
    );
    const coffee = rows.find((r) => r.kind === 'coffee_machine.start');
    expect(coffee).toMatchObject({
      person_id: personId(hh, 'Alice'),
      days: 'weekdays',
      health: 'broken',
      health_reason: 'the last 2 attempts failed',
      sequence: ['media.play'],
    });
    expect(Math.abs((coffee?.center_minute ?? 0) - 430)).toBeLessThanOrEqual(5);
    expect(rows.find((r) => r.kind === 'checkin.morning')).toMatchObject({
      person_id: personId(hh, 'Som'),
      days: 'daily',
    });

    const report2 = await t.app.get(RoutineMiner).mine(hh.id);
    expect(report2.inserted).toBe(0);
    expect(report2.updated).toBe(report1.mined);
  });
});

describe.skipIf(MALAYSIA_HOLIDAYS_2026.has(today))('check-ins', () => {
  it('asks the person first, then tells the carers, and closes both when the person checks in', async () => {
    const watcher = t.app.get(AbsenceWatcher);
    expect(await watcher.check(localAt(today, 470))).toEqual({ prompted: 0, escalated: 0 }); // 07:50: not late yet
    expect(await watcher.check(localAt(today, 495))).toEqual({ prompted: 1, escalated: 0 }); // 08:15: ask Som
    expect(await watcher.check(localAt(today, 505))).toEqual({ prompted: 0, escalated: 0 }); // asked 10 minutes ago
    expect(await watcher.check(localAt(today, 530))).toEqual({ prompted: 0, escalated: 1 }); // 08:50: tell the carers
    expect(await watcher.check(localAt(today, 560))).toEqual({ prompted: 0, escalated: 0 }); // never twice

    const { rows: notices } = await t.db.query<{
      kind: string;
      audience: string;
      text: string;
      device_id: string | null;
    }>('SELECT kind, audience, text, device_id FROM notice WHERE household_id = $1 ORDER BY created_at', [hh.id]);
    expect(notices[0]).toEqual({
      kind: 'checkin_prompt',
      audience: 'person',
      text: 'Good morning, Som. How are you today?',
      device_id: 'bedroom-echo',
    });
    expect(notices[1]).toMatchObject({ kind: 'missed_checkin', audience: 'carers' });
    expect(notices[1]?.text).toMatch(
      /^Som hasn't checked in this morning\. Usually around 07:\d\d; asked at 08:15, no reply yet\.$/,
    );

    const done = await callTool<{ logged: boolean; told: string; carers_updated: boolean }>(client, 'checkin', {
      speaker: 'Som',
      kind: 'morning',
      device: 'bedroom-echo',
    });
    expect(done).toMatchObject({ logged: true, told: 'household', carers_updated: true });

    const { rows: open } = await t.db.query<{ kind: string }>(
      'SELECT kind FROM notice WHERE household_id = $1 AND acknowledged_at IS NULL ORDER BY kind',
      [hh.id],
    );
    expect(open.map((n) => n.kind)).toEqual(['checkin', 'checkin_followup']);
    expect((await callTool<{ told: string }>(client, 'checkin', { speaker: 'Som', kind: 'morning' })).told).toBe(
      'already_told_today',
    );
    expect(await watcher.check(localAt(today, 600))).toEqual({ prompted: 0, escalated: 0 });

    const { events } = await callTool<{ events: SyncEvent[] }>(client, 'sync', {
      device: 'probe',
      cursor: 0,
      limit: 500,
    });
    expect(events.filter((e) => e.kind === 'notice.created').map((e) => e.payload.kind)).toEqual([
      'checkin_prompt',
      'missed_checkin',
      'checkin_followup',
      'checkin',
    ]);
  });

  it('never checks in for someone unidentified', async () => {
    expect((await callTool<{ refused: string }>(client, 'checkin', { kind: 'morning' })).refused).toBe(
      'unknown_speaker',
    );
  });
});
