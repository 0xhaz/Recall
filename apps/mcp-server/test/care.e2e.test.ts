// Care mode end to end: a person being cared for hears only what a caregiver entered, gets the same
// warm answer to a repeated question, caregiver policies for hard topics, and carers hear about a
// door opening at night — once, and not for movement that is usual at that hour.
import { randomUUID } from 'node:crypto';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { addDays, formatHlc, temporalStamp } from '@recall/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PresenceWatcher } from '../src/routines/presence.service.js';
import { callTool, personId, startApp, type TestApp, type TestHousehold } from './support.js';

const TZ = 'America/New_York';

interface Brief {
  facts: { content: string }[];
  repeat?: { asked_before: number; last_answer: string | null; looping: boolean; guidance: string };
  care?: {
    mode: string;
    rules: string[];
    policies: { topic: string; policy: string; guidance: string | null; set_by: string }[];
    shared_with: string[];
  };
}

let t: TestApp;
let hh: TestHousehold;
let client: Client;
let counter = 0;

const brief = (speaker: string, hint: string, device?: string) =>
  callTool<Brief>(client, 'session_brief', { speaker, hint, ...(device ? { device } : {}) });

function report(kind: string, wall: number, person: string | null, payload: Record<string, unknown> = {}) {
  return {
    event_id: randomUUID(),
    hlc: formatHlc({ wall, counter: counter++, node: 'test' }),
    kind,
    ...(person ? { person } : {}),
    payload,
  };
}

const turn = (session: string, role: 'user' | 'assistant', text: string, secondsAgo: number, person: string) =>
  report('session.turn', Date.now() - secondsAgo * 1000, person, { session_id: session, role, text });

async function fact(content: string, scope: 'person' | 'household', owner: string, origin: string) {
  await t.db.query(
    `INSERT INTO fact (id, household_id, region, scope_type, scope_id, type, content, source, confidence, sensitivity_tag)
     VALUES ($1, $2, 'us', $3, $4, 'semantic', $5, $6, 0.9, 'none')`,
    [randomUUID(), hh.id, scope, owner, content, JSON.stringify({ origin })],
  );
}

beforeAll(async () => {
  t = await startApp();
  hh = await t.createHousehold([
    ['Emma', 'owner'],
    ['Ruth', 'cared_for'],
    ['Nina', 'caregiver'],
    ['Daniel', 'adult'],
  ]);
  client = await t.mcp(hh.token);
});

afterAll(() => t?.close());

describe('care mode', () => {
  it('tells a person in care only what a caregiver entered', async () => {
    const ruth = personId(hh, 'Ruth');
    await fact('Nina visits on Saturdays', 'person', ruth, 'caregiver');
    await fact('Ruth said her son is visiting today', 'person', ruth, 'extraction');
    await fact('Family dinner is at 19:30', 'household', hh.id, 'seed');

    expect((await brief('Ruth', 'who is visiting')).facts.map((f) => f.content)).toEqual(['Nina visits on Saturdays']);
    expect((await brief('Emma', 'dinner')).facts.map((f) => f.content)).toContain('Family dinner is at 19:30');
  });

  it('answers a repeated question the same way all day in care mode, and flags only a loop otherwise', async () => {
    const morning = randomUUID();
    const later = randomUUID();
    await callTool(client, 'ingest_events', {
      device: { id: 'bedroom-echo' },
      events: [
        turn(morning, 'user', 'Is Nina coming today?', 300, 'Ruth'),
        turn(morning, 'assistant', 'Yes, Nina is coming at 3pm.', 295, 'Ruth'),
        turn(later, 'user', 'What time is it?', 60, 'Ruth'),
        turn(later, 'assistant', "It's ten past ten.", 58, 'Ruth'),
      ],
    });
    const again = await brief('Ruth', 'Is Nina coming today?', 'bedroom-echo');
    expect(again.repeat).toMatchObject({ asked_before: 1, last_answer: 'Yes, Nina is coming at 3pm.' });
    expect(again.care?.rules.join(' ')).toContain('Never say it was already asked');

    const phone = randomUUID();
    await callTool(client, 'ingest_events', {
      device: { id: 'kitchen-echo' },
      events: [
        turn(phone, 'user', 'Where is my phone?', 120, 'Daniel'),
        turn(phone, 'assistant', "I don't know where your phone is.", 118, 'Daniel'),
        turn(phone, 'user', 'Where is my phone?', 60, 'Daniel'),
        turn(phone, 'assistant', "I don't know where your phone is.", 58, 'Daniel'),
      ],
    });
    const loop = await brief('Daniel', 'where is my phone', 'kitchen-echo');
    expect(loop.repeat).toMatchObject({ looping: true, asked_before: 2 });
    expect(loop.care).toBeUndefined();
    expect((await brief('Daniel', "what's the weather", 'kitchen-echo')).repeat).toBeUndefined();
  });

  it('corrects for safety by default, redirects where the caregiver says, and only the caregiver says', async () => {
    const stove = await brief('Ruth', 'Is the stove on?');
    expect(stove.care?.policies).toEqual([expect.objectContaining({ topic: 'stove and cooking', policy: 'correct' })]);
    expect(stove.care?.shared_with).toEqual(['Nina can see your check-ins and your reminders.']);

    const policy = { person: 'Ruth', topic: 'Ahmad', keywords: ['Ahmad', 'husband'], policy: 'redirect' };
    const refused = await callTool<{ saved: boolean; refused?: string }>(client, 'set_care_policy', {
      speaker: 'Daniel',
      ...policy,
    });
    expect(refused).toMatchObject({ saved: false, refused: 'not_allowed' });
    const saved = await callTool<{ saved: boolean }>(client, 'set_care_policy', {
      speaker: 'Nina',
      ...policy,
      guidance: 'Talk about his garden. Only say he has passed if she asks directly.',
    });
    expect(saved.saved).toBe(true);

    const ahmad = await brief('Ruth', 'Where is Ahmad?');
    expect(ahmad.care?.policies).toEqual([
      expect.objectContaining({ topic: 'Ahmad', policy: 'redirect', set_by: 'caregiver' }),
    ]);
    const notCaredFor = await callTool<{ refused?: string }>(client, 'set_care_policy', {
      speaker: 'Nina',
      person: 'Emma',
      topic: 'Anything',
      policy: 'correct',
    });
    expect(notCaredFor.refused).toBe('not_cared_for');
  });

  it('tells the carers about a door opening at night once, and not about movement that is usual then', async () => {
    const today = temporalStamp(TZ).local_date;
    let night = today;
    let at = new Date(`${night}T02:10:00-04:00`);
    if (at.getTime() > Date.now()) {
      night = addDays(today, -1);
      at = new Date(`${night}T02:10:00-04:00`);
    }
    await callTool(client, 'ingest_events', {
      device: { id: 'front-door', location: 'Front door' },
      events: [report('door.open', at.getTime(), null)],
    });
    const { rows: jobs } = await t.db.query("SELECT 1 FROM job WHERE household_id = $1 AND kind = 'presence'", [hh.id]);
    expect(jobs).toHaveLength(1);

    const watcher = t.app.get(PresenceWatcher);
    const soon = new Date(at.getTime() + 60_000);
    expect(await watcher.check(hh.id, soon)).toBe(1);
    expect(await watcher.check(hh.id, soon)).toBe(0);
    const { rows } = await t.db.query(
      "SELECT audience, text FROM notice WHERE household_id = $1 AND kind = 'presence_alert'",
      [hh.id],
    );
    expect(rows).toEqual([
      { audience: 'carers', text: 'The door opened (Front door) at 02:10, which is unusual at night. Ruth may be up.' },
    ]);

    // Movement around 23:00 on most nights is a habit, not a worry.
    const evening = addDays(night, -1);
    for (const back of [2, 4, 6]) {
      await t.db.query(
        `INSERT INTO activity (household_id, region, kind, local_date, local_minute, at)
         VALUES ($1, 'us', 'motion.detected', $2, $3, now())`,
        [hh.id, addDays(evening, -back), 23 * 60],
      );
    }
    const late = new Date(`${evening}T23:05:00-04:00`);
    await callTool(client, 'ingest_events', {
      device: { id: 'hall-sensor', location: 'Hall' },
      events: [report('motion.detected', late.getTime(), null)],
    });
    expect(await watcher.check(hh.id, new Date(late.getTime() + 60_000))).toBe(0);
  });
});
