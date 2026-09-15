// Context end to end: heart rate and motion become a debounced workout for that person, sleep makes
// quiet hours for the household, a manual "stop workout mode" wins and teaches, and music follows
// the context and what the person skips in it.
import { randomUUID } from 'node:crypto';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { formatHlc } from '@recall/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type ContextReading, ContextService } from '../src/context/context.service.js';
import type { MusicSuggestion } from '../src/context/music.service.js';
import { callTool, personId, startApp, type TestApp, type TestHousehold } from './support.js';

let t: TestApp;
let hh: TestHousehold;
let client: Client;
let contexts: ContextService;
let counter = 0;
const start = new Date();
const later = (seconds: number) => new Date(start.getTime() + seconds * 1000);

function report(secondsAgo: number, kind: string, person: string, payload: Record<string, unknown> = {}) {
  return {
    event_id: randomUUID(),
    hlc: formatHlc({ wall: start.getTime() - secondsAgo * 1000, counter: counter++, node: 'test-device' }),
    kind,
    person,
    payload,
  };
}

const ingest = (device: string, events: ReturnType<typeof report>[]) =>
  callTool(client, 'ingest_events', { device: { id: device }, events });

beforeAll(async () => {
  t = await startApp();
  hh = await t.createHousehold([
    ['Alice', 'owner'],
    ['Ruth', 'adult'],
  ]);
  client = await t.mcp(hh.token);
  contexts = t.app.get(ContextService);
});

afterAll(() => t?.close());

describe('context engine', () => {
  it('turns a run into a workout for that person, only after it holds', async () => {
    const run = Array.from({ length: 12 }, (_, i) => i * 10).flatMap((ago) => [
      report(ago, 'hr.sample', 'Alice', { bpm: 150 }),
      report(ago, 'phone.motion', 'Alice', { steps_per_min: 160 }),
    ]);
    await ingest('alice-watch', run);
    const { rows: jobs } = await t.db.query("SELECT 1 FROM job WHERE household_id = $1 AND kind = 'context'", [hh.id]);
    expect(jobs).toHaveLength(1); // one re-evaluation for the whole burst

    const first = await contexts.evaluate(hh.id, start);
    const workout = first.contexts.find((c) => c.context === 'workout');
    expect(workout).toMatchObject({ for: 'Alice', score: 1, active: false });

    const held = await contexts.evaluate(hh.id, later(61));
    expect(held.contexts.find((c) => c.context === 'workout')).toMatchObject({
      active: true,
      reasons: ['heart rate 131% above resting', 'moving fast'],
    });
    const { rows: changed } = await t.db.query<{ payload: { active: boolean } }>(
      "SELECT payload FROM event WHERE household_id = $1 AND kind = 'context.changed'",
      [hh.id],
    );
    expect(changed.map((r) => r.payload.active)).toEqual([true]);
  });

  it('shows it in get_context and session_brief, without any raw heart rate', async () => {
    const reading = await callTool<ContextReading & { routines: unknown[] }>(client, 'get_context', {
      speaker: 'Alice',
    });
    expect(reading.contexts.find((c) => c.context === 'workout')?.active).toBe(true);
    expect(JSON.stringify(reading)).not.toMatch(/bpm|150/);

    const brief = await callTool<{ contexts: { context: string; for: string }[]; quiet_hours: { active: boolean } }>(
      client,
      'session_brief',
      { speaker: 'Alice' },
    );
    expect(brief.contexts).toEqual([expect.objectContaining({ context: 'workout', for: 'Alice' })]);
    expect(brief.quiet_hours.active).toBe(false);
    expect(brief).not.toHaveProperty('not_yet_available');

    // Ruth isn't working out: a personal context stays with its person.
    const ruth = await callTool<ContextReading>(client, 'get_context', { speaker: 'Ruth' });
    expect(ruth.contexts.some((c) => c.context === 'workout')).toBe(false);
  });

  it('suggests music for the workout, and learns from skips in that context only', async () => {
    const before = await callTool<MusicSuggestion>(client, 'suggest_music', { speaker: 'Alice' });
    expect(before).toMatchObject({ context: 'workout', catalogue: 'mock', decision: 'allow' });
    expect(before.tracks[0]?.title).toBe('Running Mix');

    await ingest(
      'alice-phone',
      [3, 2, 1].map((ago) => report(ago, 'media.skip', 'Alice', { track_id: 'mock-running-mix' })),
    );
    const { rows } = await t.db.query('SELECT context, skips FROM track_affinity WHERE household_id = $1', [hh.id]);
    expect(rows).toEqual([{ context: 'workout', skips: 3 }]);

    const after = await callTool<MusicSuggestion>(client, 'suggest_music', { speaker: 'Alice' });
    expect(after.tracks[0]?.title).toBe('Tempo Run');
    const bedtime = await callTool<MusicSuggestion>(client, 'suggest_music', {
      speaker: 'Alice',
      context: 'wind_down',
    });
    expect(bedtime.tracks[0]?.title).toBe('Evening Calm');
  });

  it('lets "stop workout mode" win over the signals, and "workout mode" teach the trigger', async () => {
    const off = await callTool<{ context: { active: boolean; manual: boolean } }>(client, 'set_context', {
      speaker: 'Alice',
      context: 'workout',
      on: false,
    });
    expect(off.context).toMatchObject({ active: false, manual: true });
    const still = await contexts.evaluate(hh.id, later(120));
    expect(still.contexts.find((c) => c.context === 'workout')).toMatchObject({ active: false, manual: true });

    await callTool(client, 'set_context', { speaker: 'Alice', context: 'workout', on: true });
    const { rows } = await t.db.query<{ workout_ratio: number; manual_samples: number }>(
      'SELECT workout_ratio, manual_samples FROM context_baseline WHERE household_id = $1 AND person_id = $2',
      [hh.id, personId(hh, 'Alice')],
    );
    expect(rows[0]).toEqual({ workout_ratio: 1.6, manual_samples: 1 });
  });

  it('makes quiet hours when someone goes to sleep', async () => {
    await ingest('ruth-phone', [report(0, 'sleep.start', 'Ruth')]);
    await contexts.evaluate(hh.id, later(200));
    const asleep = await contexts.evaluate(hh.id, later(321));
    expect(asleep.quiet_hours).toEqual({ active: true, because: ['someone is asleep'] });
    const brief = await callTool<{ quiet_hours: { active: boolean } }>(client, 'session_brief', { speaker: 'Alice' });
    expect(brief.quiet_hours.active).toBe(true);
  });
});
