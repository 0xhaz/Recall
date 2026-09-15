// The console API end to end: the memory browser under each person's own access rules, fixing a
// wrong fact (superseded, never overwritten), marking one wrong, the log of what a rule blocked,
// routines review, action history with undo, retention, export, and the caregiver's view.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hashToken, newToken } from '../src/auth/tokens.js';
import { callTool, personId, startApp, type TestApp, type TestHousehold } from './support.js';

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
     VALUES ($1, 'us', $2, $3, 'semantic', $4, $5, 0.9, 'none') RETURNING id`,
    [hh.id, scope, owner, content, JSON.stringify({ origin })],
  );
  const id = rows[0]?.id;
  if (!id) throw new Error('fact not inserted');
  return id;
}

beforeAll(async () => {
  t = await startApp();
  hh = await t.createHousehold([
    ['Emma', 'owner'],
    ['Sofia', 'child'],
    ['Ruth', 'cared_for'],
    ['Nina', 'caregiver'],
    ['Tom', 'guest'],
  ]);
  for (const name of ['Emma', 'Sofia', 'Ruth', 'Nina', 'Tom']) await signIn(name);
});

afterAll(() => t?.close());

describe('memory browser', () => {
  it("shows household memory and the person's own, never someone else's", async () => {
    await fact('Family dinner is usually around 19:30', 'household', hh.id);
    await fact('Emma is vegetarian', 'person', personId(hh, 'Emma'));
    await fact('Sofia is allergic to peanuts', 'person', personId(hh, 'Sofia'));
    await fact('Ruth takes her tea with condensed milk', 'person', personId(hh, 'Ruth'), 'caregiver');

    const mine = await api<{ facts: FactView[] }>('Emma', '/facts');
    expect(mine.body.facts.map((f) => f.content).sort()).toEqual([
      'Emma is vegetarian',
      'Family dinner is usually around 19:30',
      'Sofia is allergic to peanuts',
    ]);
    // A parent may erase what is held about their child, but not put different words in their mouth.
    const child = mine.body.facts.find((f) => f.scope_name === 'Sofia');
    expect(child).toMatchObject({ editable: false, deletable: true });
    const own = mine.body.facts.find((f) => f.content === 'Emma is vegetarian');
    expect(own).toMatchObject({ editable: true, deletable: true });

    const hers = await api<{ facts: FactView[] }>('Ruth', '/facts');
    expect(hers.body.facts.map((f) => f.content).sort()).toEqual([
      'Family dinner is usually around 19:30',
      'Ruth takes her tea with condensed milk',
    ]);
    // A caregiver without view_full_memory sees the household's memory, not the person's own.
    const carer = await api<{ facts: FactView[] }>('Nina', '/facts');
    expect(carer.body.facts.map((f) => f.content)).toEqual(['Family dinner is usually around 19:30']);
  });

  it('fixes a wrong fact by superseding it, and tells every device', async () => {
    const wrong = await fact('Daniel likes very mild food', 'household', hh.id);
    const fixed = await api<{ corrected: string; content: string }>('Emma', `/facts/${wrong}`, {
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

    const current = await api<{ facts: FactView[] }>('Emma', '/facts?query=spicy');
    expect(current.body.facts[0]?.content).toBe('Daniel likes very spicy food');
  });

  it('marks a fact wrong by forgetting it, and refuses a guest', async () => {
    const gone = await fact('The spare key is under the mat', 'household', hh.id);
    const guest = await api('Tom', `/facts/${gone}`, { method: 'DELETE' });
    expect(guest.status).toBe(403);

    const forgotten = await api<{ forgotten: string[] }>('Emma', `/facts/${gone}`, { method: 'DELETE' });
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
       VALUES ($1, 'us', $2, 'media.play', 'Play Running Mix', 'blocked', $3)`,
      [
        hh.id,
        personId(hh, 'Emma'),
        JSON.stringify({ decision: 'block', blocked_by: { rule_id: 'r1', text: 'No music after 10pm' } }),
      ],
    );
    const res = await api<{ blocked: { summary: string; rule: { text: string } | null }[] }>('Emma', '/rules');
    expect(res.body.blocked[0]).toMatchObject({
      summary: 'Play Running Mix',
      rule: { text: 'No music after 10pm' },
    });
  });

  it('accepts a candidate routine', async () => {
    const { rows } = await t.db.query<{ id: string }>(
      `INSERT INTO routine (household_id, region, person_id, kind, days, center_minute, spread_minutes, support,
                            confidence, last_seen, status)
       VALUES ($1, 'us', $2, 'coffee_machine.start', 'weekdays', 430, 8, 12, 0.8, now()::date, 'candidate')
       RETURNING id`,
      [hh.id, personId(hh, 'Emma')],
    );
    const routineId = rows[0]?.id ?? '';
    const listed = await api<{ routines: { id: string; status: string; kind: string }[] }>('Emma', '/routines');
    expect(listed.body.routines.find((r) => r.id === routineId)).toMatchObject({ status: 'candidate' });

    const accepted = await api<{ status: string }>('Emma', `/routines/${routineId}`, {
      method: 'POST',
      body: { decision: 'accept' },
    });
    expect(accepted.body.status).toBe('active');
  });

  it('shows the action history and undoes one while its window is open', async () => {
    const { rows } = await t.db.query<{ id: string }>(
      `INSERT INTO action (household_id, region, person_id, intent, summary, status, command, preflight,
                           decided_at, undo_until)
       VALUES ($1, 'us', $2, 'smart_home', 'Start the coffee machine', 'executed',
               $3, '{"decision":"allow"}', now(), now() + interval '5 minutes')
       RETURNING id`,
      [hh.id, personId(hh, 'Emma'), JSON.stringify({ kind: 'coffee_machine.start', payload: {} })],
    );
    const actionId = rows[0]?.id ?? '';
    const history = await api<{ actions: { id: string; undoable: boolean }[] }>('Emma', '/actions');
    expect(history.body.actions.find((a) => a.id === actionId)).toMatchObject({ undoable: true });

    const undone = await api<{ status?: string; command?: { kind: string } }>('Emma', `/actions/${actionId}/undo`, {
      method: 'POST',
    });
    expect(undone.body).toMatchObject({ status: 'undone', command: { kind: 'coffee_machine.stop' } });
  });
});

describe('household, settings and care', () => {
  it('shows context, devices, people and notices', async () => {
    const context = await api<{ contexts: unknown[]; quiet_hours: { active: boolean } }>('Emma', '/context');
    expect(context.body.quiet_hours).toHaveProperty('active');

    const people = await api<{ people: { name: string; role: string }[] }>('Emma', '/people');
    expect(people.body.people.map((p) => p.role).sort()).toEqual(['cared_for', 'caregiver', 'child', 'guest', 'owner']);

    const devices = await api<{ devices: unknown[] }>('Emma', '/devices');
    expect(Array.isArray(devices.body.devices)).toBe(true);
    const notices = await api<{ notices: unknown[] }>('Emma', '/notices');
    expect(Array.isArray(notices.body.notices)).toBe(true);
  });

  it('lets the owner set retention, and nobody else', async () => {
    const owner = await api<{ retention_days: number }>('Emma', '/settings', {
      method: 'PATCH',
      body: { retention_days: 30 },
    });
    expect(owner.body.retention_days).toBe(30);
    const carer = await api('Nina', '/settings', { method: 'PATCH', body: { retention_days: 365 } });
    expect(carer.status).toBe(403);
    const tooShort = await api('Emma', '/settings', { method: 'PATCH', body: { retention_days: 1 } });
    expect(tooShort.status).toBe(400);
  });

  it('exports everything the person may see', async () => {
    const res = await api<{ household: { retention_days: number }; facts: FactView[]; routines: unknown[] }>(
      'Emma',
      '/export',
    );
    expect(res.body.household.retention_days).toBe(30);
    expect(res.body.facts.length).toBeGreaterThan(0);
    expect(res.body.routines.length).toBeGreaterThan(0);
  });

  it('gives the caregiver the care plan, with the built-in policies and one of their own', async () => {
    const ruth = personId(hh, 'Ruth');
    const plan = await api<{ can_edit: boolean; policies: { topic: string; set_by: string }[] }>(
      'Nina',
      `/care/${ruth}`,
    );
    expect(plan.body.can_edit).toBe(true);
    expect(plan.body.policies.map((p) => p.topic)).toContain('medication');

    const saved = await api<{ saved: boolean }>('Nina', '/care/policies', {
      method: 'POST',
      body: {
        person: 'Ruth',
        topic: 'Ahmad',
        keywords: ['Ahmad'],
        policy: 'redirect',
        guidance: 'Talk about his garden.',
      },
    });
    expect(saved.body.saved).toBe(true);
    const after = await api<{ policies: { topic: string; set_by: string }[] }>('Nina', `/care/${ruth}`);
    expect(after.body.policies.find((p) => p.topic === 'Ahmad')).toMatchObject({ set_by: 'caregiver' });
  });
});

describe('medication reminders', () => {
  it('takes a schedule from the caregiver and records a dose confirmed in the console', async () => {
    const ruth = personId(hh, 'Ruth');
    const saved = await api<{ saved: boolean; id: string }>('Nina', '/care/reminders', {
      method: 'POST',
      body: {
        person: 'Ruth',
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
    }>('Nina', `/care/${ruth}`);
    expect(plan.body.reminders[0]).toMatchObject({ label: 'Blood pressure tablet', times: ['08:00', '20:00'] });
    expect(plan.body.doses.map((d) => d.due)).toEqual(['08:00', '20:00']);

    // A dose the watcher has already asked about, still waiting to be confirmed.
    const { rows } = await t.db.query<{ id: string }>(
      `INSERT INTO care_reminder_log (household_id, region, reminder_id, person_id, local_date, local_minute,
                                      due_at, status, prompted_at)
       VALUES ($1, 'us', $2, $3, (now() AT TIME ZONE (SELECT timezone FROM household WHERE id = $1))::date, 480,
               now() - interval '1 hour', 'pending', now() - interval '1 hour')
       RETURNING id`,
      [hh.id, saved.body.id, ruth],
    );
    const logId = rows[0]?.id;
    const done = await api<{ confirmed: boolean }>('Nina', `/care/doses/${logId}/confirm`, {
      method: 'POST',
      body: { note: 'took it with breakfast' },
    });
    expect(done.body.confirmed).toBe(true);

    // Confirmed, and kept as what it is: recorded by a carer, not the person's own word.
    const morning = await api<{ doses: { due: string; status: string; how: string | null; note: string | null }[] }>(
      'Nina',
      `/care/${ruth}`,
    );
    expect(morning.body.doses.find((d) => d.due === '08:00')).toMatchObject({
      status: 'confirmed',
      how: 'console',
      note: 'took it with breakfast',
    });
  });

  it('refuses a guest who tries to set one', async () => {
    const res = await api('Tom', '/care/reminders', {
      method: 'POST',
      body: { person: 'Ruth', label: 'Something', times: ['09:00'] },
    });
    expect(res.status).toBe(403);
  });
});

describe('people', () => {
  it('lets the owner add someone, and nobody else', async () => {
    const denied = await api('Sofia', '/people', { method: 'POST', body: { name: 'Leo', role: 'adult' } });
    expect(denied.status).toBe(403);

    const added = await api<{ person_id: string; role: string }>('Emma', '/people', {
      method: 'POST',
      body: { name: 'Leo', email: 'leo@test.local', role: 'adult' },
    });
    expect(added.status).toBe(201);
    expect(added.body.role).toBe('adult');
    const { body } = await api<{ people: { name: string; role: string }[] }>('Emma', '/people');
    expect(body.people.find((p) => p.name === 'Leo')).toMatchObject({ role: 'adult' });
  });

  it('gives a caregiver the default grants, and refuses a second owner', async () => {
    const carer = await api<{ person_id: string }>('Emma', '/people', {
      method: 'POST',
      body: { name: 'Priya', email: 'priya@test.local', role: 'caregiver' },
    });
    expect(carer.status).toBe(201);
    const { body } = await api<{ people: { name: string; grants: string[] }[] }>('Emma', '/people');
    expect(body.people.find((p) => p.name === 'Priya')?.grants).toContain('edit_care_plan');

    const second = await api('Emma', '/people', { method: 'POST', body: { name: 'Max', role: 'owner' } });
    expect(second.status).toBe(400);
  });

  it('will not add the same person twice', async () => {
    const again = await api('Emma', '/people', {
      method: 'POST',
      body: { name: 'Leo', email: 'leo@test.local', role: 'adult' },
    });
    expect(again.status).toBe(400);
  });

  it('removes someone by revoking, so the record of them having been here survives', async () => {
    const { body: before } = await api<{ people: { person_id: string; name: string }[] }>('Emma', '/people');
    const leo = before.people.find((p) => p.name === 'Leo');
    if (!leo) throw new Error('Leo missing');

    const removed = await api('Emma', `/people/${leo.person_id}`, { method: 'DELETE' });
    expect(removed.status).toBe(200);

    const { body: after } = await api<{ people: { name: string }[] }>('Emma', '/people');
    expect(after.people.some((p) => p.name === 'Leo')).toBe(false);
    const { rows } = await t.db.query('SELECT revoked_at FROM membership WHERE household_id = $1 AND person_id = $2', [
      hh.id,
      leo.person_id,
    ]);
    expect(rows[0]?.revoked_at).not.toBeNull();
    const log = await t.db.query(
      `SELECT 1 FROM audit_log WHERE household_id = $1 AND action = 'membership.revoked' AND target_id = $2`,
      [hh.id, leo.person_id],
    );
    expect(log.rowCount).toBe(1);
  });

  it('never removes the owner', async () => {
    const { body } = await api<{ people: { person_id: string; role: string }[] }>('Emma', '/people');
    const owner = body.people.find((p) => p.role === 'owner');
    if (!owner) throw new Error('no owner');
    expect((await api('Emma', `/people/${owner.person_id}`, { method: 'DELETE' })).status).toBe(400);
  });

  it('lets a cared-for person revoke their own caregiver', async () => {
    const { body } = await api<{ people: { person_id: string; name: string }[] }>('Emma', '/people');
    const nina = body.people.find((p) => p.name === 'Nina');
    if (!nina) throw new Error('Nina missing');
    // Ruth is cared for and has no capacity flag, so this is hers to do (architecture.md §1.3).
    expect((await api('Ruth', `/people/${nina.person_id}`, { method: 'DELETE' })).status).toBe(200);
  });
});

describe('forget by date range', () => {
  it('forgets what was recorded in the window, and leaves the rest alone', async () => {
    const old = await fact('Emma booked a table on Tuesday', 'household', hh.id);
    const recent = await fact('Emma is learning Spanish', 'household', hh.id);
    await t.db.query(`UPDATE fact SET valid_from = '2026-03-10T12:00:00Z' WHERE id = $1`, [old]);
    await t.db.query(`UPDATE fact SET valid_from = '2026-05-01T12:00:00Z' WHERE id = $1`, [recent]);

    const { status, body } = await api<{ forgotten: number }>('Emma', '/forget-range', {
      method: 'POST',
      body: { from: '2026-03-09', to: '2026-03-11' },
    });
    expect(status).toBe(201);
    expect(body.forgotten).toBeGreaterThanOrEqual(1);

    const { rows } = await t.db.query<{ id: string; content: string; forgotten_at: Date | null }>(
      'SELECT id, content, forgotten_at FROM fact WHERE id = ANY($1::uuid[])',
      [[old, recent]],
    );
    const gone = rows.find((r) => r.id === old);
    const kept = rows.find((r) => r.id === recent);
    expect(gone?.forgotten_at).not.toBeNull();
    expect(gone?.content).toBe(''); // the words are erased, not just hidden
    expect(kept?.forgotten_at).toBeNull();
  });

  it('refuses a range that ends before it starts', async () => {
    const bad = await api('Emma', '/forget-range', { method: 'POST', body: { from: '2026-05-02', to: '2026-05-01' } });
    expect(bad.status).toBe(400);
  });
});

describe('temporary mode', () => {
  it('stops reading and writing while paused, and says so plainly', async () => {
    const client = await t.mcp(hh.token);
    expect((await api('Emma', '/pause', { method: 'POST', body: { minutes: 30 } })).status).toBe(201);

    const brief = await callTool<{ paused?: boolean; message?: string }>(client, 'session_brief', { speaker: 'Emma' });
    expect(brief.paused).toBe(true);
    expect(brief.message).toContain('paused');

    const stored = await callTool<{ paused?: boolean }>(client, 'remember', { speaker: 'Emma', text: 'I like pears' });
    expect(stored.paused).toBe(true);
    const { rows } = await t.db.query(`SELECT 1 FROM utterance WHERE text = 'I like pears'`);
    expect(rows).toHaveLength(0);

    expect((await api('Emma', '/pause', { method: 'POST', body: { minutes: 0 } })).status).toBe(201);
    const resumed = await callTool<{ paused?: boolean }>(client, 'session_brief', { speaker: 'Emma' });
    expect(resumed.paused).toBeUndefined();
    await client.close();
  });

  it('is not a guest or child decision', async () => {
    expect((await api('Sofia', '/pause', { method: 'POST', body: { minutes: 30 } })).status).toBe(403);
  });
});
