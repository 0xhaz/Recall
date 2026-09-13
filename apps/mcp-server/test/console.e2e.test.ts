// The console API end to end: the memory browser under each person's own access rules, fixing a
// wrong fact (superseded, never overwritten), marking one wrong, the log of what a rule blocked,
// routines review, action history with undo, retention, export, and the caregiver's view.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hashToken, newToken } from '../src/auth/tokens.js';
import { personId, startApp, type TestApp, type TestHousehold } from './support.js';

let t: TestApp;
let hh: TestHousehold;
const session: Record<string, string> = {};

interface FactView {
  id: string;
  content: string;
  scope: string;
  scope_name: string | null;
  editable: boolean;
  deletable: boolean;
  superseded_by: string | null;
  forgotten_at: string | null;
}

async function api<T>(
  who: string,
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<{ status: number; body: T }> {
  const res = await fetch(`${t.baseUrl}/console/households/${hh.id}${path}`, {
    method: init.method ?? 'GET',
    headers: {
      Authorization: `Bearer ${session[who]}`,
      ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  });
  return { status: res.status, body: (await res.json()) as T };
}

async function signIn(name: string): Promise<void> {
  const token = newToken('rcl_sess');
  await t.db.query(
    `INSERT INTO console_session (person_id, token_hash, expires_at) VALUES ($1, $2, now() + interval '1 day')`,
    [personId(hh, name), hashToken(token)],
  );
  session[name] = token;
}

async function fact(content: string, scope: 'person' | 'household', owner: string, origin = 'extraction') {
  const { rows } = await t.db.query<{ id: string }>(
    `INSERT INTO fact (household_id, region, scope_type, scope_id, type, content, source, confidence, sensitivity_tag)
     VALUES ($1, 'my', $2, $3, 'semantic', $4, $5, 0.9, 'none') RETURNING id`,
    [hh.id, scope, owner, content, JSON.stringify({ origin })],
  );
  const id = rows[0]?.id;
  if (!id) throw new Error('fact not inserted');
  return id;
}

beforeAll(async () => {
  t = await startApp();
  hh = await t.createHousehold([
    ['Aisyah', 'owner'],
    ['Sofia', 'child'],
    ['Som', 'cared_for'],
    ['Farah', 'caregiver'],
    ['Ravi', 'guest'],
  ]);
  for (const name of ['Aisyah', 'Sofia', 'Som', 'Farah', 'Ravi']) await signIn(name);
});

afterAll(() => t?.close());

describe('memory browser', () => {
  it("shows household memory and the person's own, never someone else's", async () => {
    await fact('Family dinner is usually around 19:30', 'household', hh.id);
    await fact('Aisyah is vegetarian', 'person', personId(hh, 'Aisyah'));
    await fact('Sofia is allergic to peanuts', 'person', personId(hh, 'Sofia'));
    await fact('Mak Som takes her tea with condensed milk', 'person', personId(hh, 'Som'), 'caregiver');

    const mine = await api<{ facts: FactView[] }>('Aisyah', '/facts');
    expect(mine.body.facts.map((f) => f.content).sort()).toEqual([
      'Aisyah is vegetarian',
      'Family dinner is usually around 19:30',
      'Sofia is allergic to peanuts',
    ]);
    // A parent may erase what is held about their child, but not put different words in their mouth.
    const child = mine.body.facts.find((f) => f.scope_name === 'Sofia');
    expect(child).toMatchObject({ editable: false, deletable: true });
    const own = mine.body.facts.find((f) => f.content === 'Aisyah is vegetarian');
    expect(own).toMatchObject({ editable: true, deletable: true });

    const hers = await api<{ facts: FactView[] }>('Som', '/facts');
    expect(hers.body.facts.map((f) => f.content).sort()).toEqual([
      'Family dinner is usually around 19:30',
      'Mak Som takes her tea with condensed milk',
    ]);
    // A caregiver without view_full_memory sees the household's memory, not the person's own.
    const carer = await api<{ facts: FactView[] }>('Farah', '/facts');
    expect(carer.body.facts.map((f) => f.content)).toEqual(['Family dinner is usually around 19:30']);
  });

  it('fixes a wrong fact by superseding it, and tells every device', async () => {
    const wrong = await fact('Daniel likes very mild food', 'household', hh.id);
    const fixed = await api<{ corrected: string; content: string }>('Aisyah', `/facts/${wrong}`, {
      method: 'PATCH',
      body: { content: 'Daniel likes very spicy food' },
    });
    expect(fixed.status).toBe(200);
    expect(fixed.body.content).toBe('Daniel likes very spicy food');

    const { rows } = await t.db.query<{ id: string; valid_to: Date | null; superseded_by: string | null }>(
      'SELECT id, valid_to, superseded_by FROM fact WHERE id = $1',
      [wrong],
    );
    expect(rows[0]?.valid_to).not.toBeNull();
    expect(rows[0]?.superseded_by).toBe(fixed.body.corrected);

    const { rows: events } = await t.db.query<{ kind: string }>(
      `SELECT kind FROM event WHERE household_id = $1 AND kind IN ('fact.created', 'fact.superseded')
        ORDER BY seq DESC LIMIT 2`,
      [hh.id],
    );
    expect(events.map((e) => e.kind).sort()).toEqual(['fact.created', 'fact.superseded']);
    const { rows: jobs } = await t.db.query("SELECT 1 FROM job WHERE household_id = $1 AND kind = 'embed'", [hh.id]);
    expect(jobs.length).toBeGreaterThan(0);

    const current = await api<{ facts: FactView[] }>('Aisyah', '/facts?query=spicy');
    expect(current.body.facts[0]?.content).toBe('Daniel likes very spicy food');
  });

  it('marks a fact wrong by forgetting it, and refuses a guest', async () => {
    const gone = await fact('The spare key is under the mat', 'household', hh.id);
    const guest = await api('Ravi', `/facts/${gone}`, { method: 'DELETE' });
    expect(guest.status).toBe(403);

    const forgotten = await api<{ forgotten: string[] }>('Aisyah', `/facts/${gone}`, { method: 'DELETE' });
    expect(forgotten.body.forgotten).toEqual([gone]);
    const { rows } = await t.db.query<{ content: string; forgotten_at: Date | null }>(
      'SELECT content, forgotten_at FROM fact WHERE id = $1',
      [gone],
    );
    expect(rows[0]).toMatchObject({ content: '' });
    expect(rows[0]?.forgotten_at).not.toBeNull();
  });

  it('refuses anyone who is not a member', async () => {
    const outsider = newToken('rcl_sess');
    const { rows } = await t.db.query<{ id: string }>(
      `INSERT INTO person (display_name, email) VALUES ('Outsider', $1) RETURNING id`,
      [`outsider-${randomUUID().slice(0, 8)}@test.local`],
    );
    await t.db.query(
      `INSERT INTO console_session (person_id, token_hash, expires_at) VALUES ($1, $2, now() + interval '1 day')`,
      [rows[0]?.id, hashToken(outsider)],
    );
    const res = await fetch(`${t.baseUrl}/console/households/${hh.id}/facts`, {
      headers: { Authorization: `Bearer ${outsider}` },
    });
    expect(res.status).toBe(403);
    await t.db.query('DELETE FROM console_session WHERE person_id = $1', [rows[0]?.id]);
    await t.db.query('DELETE FROM person WHERE id = $1', [rows[0]?.id]);
  });
});

describe('rules, routines and actions', () => {
  it('lists what a rule blocked', async () => {
    await t.db.query(
      `INSERT INTO action (household_id, region, person_id, intent, summary, status, preflight)
       VALUES ($1, 'my', $2, 'media.play', 'Play Running Mix', 'blocked', $3)`,
      [
        hh.id,
        personId(hh, 'Aisyah'),
        JSON.stringify({ decision: 'block', blocked_by: { rule_id: 'r1', text: 'No music after 10pm' } }),
      ],
    );
    const res = await api<{ blocked: { summary: string; rule: { text: string } | null }[] }>('Aisyah', '/rules');
    expect(res.body.blocked[0]).toMatchObject({
      summary: 'Play Running Mix',
      rule: { text: 'No music after 10pm' },
    });
  });

  it('accepts a candidate routine', async () => {
    const { rows } = await t.db.query<{ id: string }>(
      `INSERT INTO routine (household_id, region, person_id, kind, days, center_minute, spread_minutes, support,
                            confidence, last_seen, status)
       VALUES ($1, 'my', $2, 'coffee_machine.start', 'weekdays', 430, 8, 12, 0.8, now()::date, 'candidate')
       RETURNING id`,
      [hh.id, personId(hh, 'Aisyah')],
    );
    const routineId = rows[0]?.id ?? '';
    const listed = await api<{ routines: { id: string; status: string; kind: string }[] }>('Aisyah', '/routines');
    expect(listed.body.routines.find((r) => r.id === routineId)).toMatchObject({ status: 'candidate' });

    const accepted = await api<{ status: string }>('Aisyah', `/routines/${routineId}`, {
      method: 'POST',
      body: { decision: 'accept' },
    });
    expect(accepted.body.status).toBe('active');
  });

  it('shows the action history and undoes one while its window is open', async () => {
    const { rows } = await t.db.query<{ id: string }>(
      `INSERT INTO action (household_id, region, person_id, intent, summary, status, command, preflight,
                           decided_at, undo_until)
       VALUES ($1, 'my', $2, 'smart_home', 'Start the coffee machine', 'executed',
               $3, '{"decision":"allow"}', now(), now() + interval '5 minutes')
       RETURNING id`,
      [hh.id, personId(hh, 'Aisyah'), JSON.stringify({ kind: 'coffee_machine.start', payload: {} })],
    );
    const actionId = rows[0]?.id ?? '';
    const history = await api<{ actions: { id: string; undoable: boolean }[] }>('Aisyah', '/actions');
    expect(history.body.actions.find((a) => a.id === actionId)).toMatchObject({ undoable: true });

    const undone = await api<{ status?: string; command?: { kind: string } }>('Aisyah', `/actions/${actionId}/undo`, {
      method: 'POST',
    });
    expect(undone.body).toMatchObject({ status: 'undone', command: { kind: 'coffee_machine.stop' } });
  });
});

describe('household, settings and care', () => {
  it('shows context, devices, people and notices', async () => {
    const context = await api<{ contexts: unknown[]; quiet_hours: { active: boolean } }>('Aisyah', '/context');
    expect(context.body.quiet_hours).toHaveProperty('active');

    const people = await api<{ people: { name: string; role: string }[] }>('Aisyah', '/people');
    expect(people.body.people.map((p) => p.role).sort()).toEqual(['cared_for', 'caregiver', 'child', 'guest', 'owner']);

    const devices = await api<{ devices: unknown[] }>('Aisyah', '/devices');
    expect(Array.isArray(devices.body.devices)).toBe(true);
    const notices = await api<{ notices: unknown[] }>('Aisyah', '/notices');
    expect(Array.isArray(notices.body.notices)).toBe(true);
  });

  it('lets the owner set retention, and nobody else', async () => {
    const owner = await api<{ retention_days: number }>('Aisyah', '/settings', {
      method: 'PATCH',
      body: { retention_days: 30 },
    });
    expect(owner.body.retention_days).toBe(30);
    const carer = await api('Farah', '/settings', { method: 'PATCH', body: { retention_days: 365 } });
    expect(carer.status).toBe(403);
    const tooShort = await api('Aisyah', '/settings', { method: 'PATCH', body: { retention_days: 1 } });
    expect(tooShort.status).toBe(400);
  });

  it('exports everything the person may see', async () => {
    const res = await api<{ household: { retention_days: number }; facts: FactView[]; routines: unknown[] }>(
      'Aisyah',
      '/export',
    );
    expect(res.body.household.retention_days).toBe(30);
    expect(res.body.facts.length).toBeGreaterThan(0);
    expect(res.body.routines.length).toBeGreaterThan(0);
  });

  it('gives the caregiver the care plan, with the built-in policies and one of their own', async () => {
    const som = personId(hh, 'Som');
    const plan = await api<{ can_edit: boolean; policies: { topic: string; set_by: string }[] }>(
      'Farah',
      `/care/${som}`,
    );
    expect(plan.body.can_edit).toBe(true);
    expect(plan.body.policies.map((p) => p.topic)).toContain('medication');

    const saved = await api<{ saved: boolean }>('Farah', '/care/policies', {
      method: 'POST',
      body: {
        person: 'Som',
        topic: 'Ahmad',
        keywords: ['Ahmad'],
        policy: 'redirect',
        guidance: 'Talk about his garden.',
      },
    });
    expect(saved.body.saved).toBe(true);
    const after = await api<{ policies: { topic: string; set_by: string }[] }>('Farah', `/care/${som}`);
    expect(after.body.policies.find((p) => p.topic === 'Ahmad')).toMatchObject({ set_by: 'caregiver' });
  });
});

describe('medication reminders', () => {
  it('takes a schedule from the caregiver and records a dose confirmed in the console', async () => {
    const som = personId(hh, 'Som');
    const saved = await api<{ saved: boolean; id: string }>('Farah', '/care/reminders', {
      method: 'POST',
      body: {
        person: 'Som',
        label: 'Blood pressure tablet',
        dose: 'one tablet',
        times: ['08:00', '20:00'],
        escalate_after_minutes: 30,
      },
    });
    expect(saved.status).toBe(200);

    const plan = await api<{
      reminders: { label: string; times: string[] }[];
      doses: { due: string }[];
    }>('Farah', `/care/${som}`);
    expect(plan.body.reminders[0]).toMatchObject({ label: 'Blood pressure tablet', times: ['08:00', '20:00'] });
    expect(plan.body.doses.map((d) => d.due)).toEqual(['08:00', '20:00']);

    // A dose the watcher has already asked about, still waiting to be confirmed.
    const { rows } = await t.db.query<{ id: string }>(
      `INSERT INTO care_reminder_log (household_id, region, reminder_id, person_id, local_date, local_minute,
                                      due_at, status, prompted_at)
       VALUES ($1, 'my', $2, $3, (now() AT TIME ZONE (SELECT timezone FROM household WHERE id = $1))::date, 480,
               now() - interval '1 hour', 'pending', now() - interval '1 hour')
       RETURNING id`,
      [hh.id, saved.body.id, som],
    );
    const logId = rows[0]?.id;
    const done = await api<{ confirmed: boolean }>('Farah', `/care/doses/${logId}/confirm`, {
      method: 'POST',
      body: { note: 'took it with breakfast' },
    });
    expect(done.body.confirmed).toBe(true);

    // Confirmed, and kept as what it is: recorded by a carer, not the person's own word.
    const morning = await api<{ doses: { due: string; status: string; how: string | null; note: string | null }[] }>(
      'Farah',
      `/care/${som}`,
    );
    expect(morning.body.doses.find((d) => d.due === '08:00')).toMatchObject({
      status: 'confirmed',
      how: 'console',
      note: 'took it with breakfast',
    });
  });

  it('refuses a guest who tries to set one', async () => {
    const res = await api('Ravi', '/care/reminders', {
      method: 'POST',
      body: { person: 'Som', label: 'Something', times: ['09:00'] },
    });
    expect(res.status).toBe(403);
  });
});
