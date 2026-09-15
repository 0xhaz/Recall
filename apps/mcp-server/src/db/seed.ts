import { pathToFileURL } from 'node:url';
import { DEFAULT_CAREGIVER_GRANTS, type Grant, type MembershipRole } from '@recall/core';
import pg from 'pg';
import { hashToken } from '../auth/tokens.js';
import { loadDotEnv } from '../env.js';
import { DEMO_HOUSEHOLD_ID, DEMO_PEOPLE, NINA_HOUSEHOLD_ID } from './seed-ids.js';

// Demo households for both directions (design.md §7):
//  - Demo household: Emma (owner), Daniel (adult), Sofia (child), Ruth (cared for), Tom (guest),
//    and Nina as caregiver, who lives in her own household.
//  - Nina's flat: Nina (owner), to show memory never crosses households.

const DEMO_TIMEZONE = 'America/New_York';

const households = [
  { id: DEMO_HOUSEHOLD_ID, name: 'Demo household' },
  { id: NINA_HOUSEHOLD_ID, name: "Nina's flat" },
];

const people = [
  // The owner's address is configurable so a deployment can point her at a mailbox that exists:
  // the demo domain is not real, and a sign-in link sent there goes nowhere.
  { id: DEMO_PEOPLE.emma, name: 'Emma', email: process.env.DEMO_OWNER_EMAIL ?? 'emma@demo.recall.local' },
  { id: DEMO_PEOPLE.daniel, name: 'Daniel', email: 'daniel@demo.recall.local' },
  { id: DEMO_PEOPLE.sofia, name: 'Sofia', email: null },
  { id: DEMO_PEOPLE.som, name: 'Ruth', email: null },
  { id: DEMO_PEOPLE.nina, name: 'Nina', email: 'nina@demo.recall.local' },
  { id: DEMO_PEOPLE.tom, name: 'Tom', email: null },
];

const memberships: { household: string; person: string; role: MembershipRole; grants: readonly Grant[] }[] = [
  { household: DEMO_HOUSEHOLD_ID, person: DEMO_PEOPLE.emma, role: 'owner', grants: [] },
  { household: DEMO_HOUSEHOLD_ID, person: DEMO_PEOPLE.daniel, role: 'adult', grants: [] },
  { household: DEMO_HOUSEHOLD_ID, person: DEMO_PEOPLE.sofia, role: 'child', grants: [] },
  { household: DEMO_HOUSEHOLD_ID, person: DEMO_PEOPLE.som, role: 'cared_for', grants: [] },
  { household: DEMO_HOUSEHOLD_ID, person: DEMO_PEOPLE.nina, role: 'caregiver', grants: DEFAULT_CAREGIVER_GRANTS },
  { household: DEMO_HOUSEHOLD_ID, person: DEMO_PEOPLE.tom, role: 'guest', grants: [] },
  { household: NINA_HOUSEHOLD_ID, person: DEMO_PEOPLE.nina, role: 'owner', grants: [] },
];

const facts = [
  {
    id: 'f1',
    household: DEMO_HOUSEHOLD_ID,
    scope: 'person',
    owner: DEMO_PEOPLE.emma,
    type: 'semantic',
    content: 'Emma is vegetarian',
    confidence: 0.95,
    tag: 'none',
    origin: 'seed',
  },
  {
    id: 'f2',
    household: DEMO_HOUSEHOLD_ID,
    scope: 'person',
    owner: DEMO_PEOPLE.daniel,
    type: 'semantic',
    content: 'Daniel likes very spicy food',
    confidence: 0.9,
    tag: 'none',
    origin: 'seed',
  },
  {
    id: 'f3',
    household: DEMO_HOUSEHOLD_ID,
    scope: 'person',
    owner: DEMO_PEOPLE.sofia,
    type: 'semantic',
    content: 'Sofia is allergic to peanuts',
    confidence: 0.99,
    tag: 'health',
    origin: 'seed',
  },
  {
    id: 'f4',
    household: DEMO_HOUSEHOLD_ID,
    scope: 'household',
    owner: DEMO_HOUSEHOLD_ID,
    type: 'semantic',
    content: "The family's usual weeknight takeaway is Napoli Pizza",
    confidence: 0.8,
    tag: 'none',
    origin: 'seed',
  },
  {
    id: 'f5',
    household: DEMO_HOUSEHOLD_ID,
    scope: 'household',
    owner: DEMO_HOUSEHOLD_ID,
    type: 'procedural',
    content: 'Family dinner is usually around 19:30 on weekdays',
    confidence: 0.7,
    tag: 'none',
    origin: 'seed',
  },
  {
    id: 'f8',
    household: DEMO_HOUSEHOLD_ID,
    scope: 'household',
    owner: DEMO_HOUSEHOLD_ID,
    type: 'semantic',
    content: "The family's home delivery address is 412 Bergen Street, Brooklyn",
    confidence: 0.95,
    tag: 'pii',
    origin: 'seed',
  },
  {
    id: 'f6',
    household: DEMO_HOUSEHOLD_ID,
    scope: 'person',
    owner: DEMO_PEOPLE.som,
    type: 'semantic',
    content: 'Ruth takes her tea with condensed milk',
    confidence: 0.95,
    tag: 'none',
    origin: 'caregiver',
  },
  {
    id: 'f7',
    household: NINA_HOUSEHOLD_ID,
    scope: 'person',
    owner: DEMO_PEOPLE.nina,
    type: 'procedural',
    content: 'Nina works night shifts on Tuesdays',
    confidence: 0.9,
    tag: 'none',
    origin: 'seed',
  },
  {
    // Gives the pre-flight read-back something real to stop for (design.md §3.2).
    id: 'fa',
    household: DEMO_HOUSEHOLD_ID,
    scope: 'household',
    owner: DEMO_HOUSEHOLD_ID,
    type: 'semantic',
    content: "Sofia's birthday is March 3",
    confidence: 0.95,
    tag: 'none',
    origin: 'seed',
  },
  {
    // A cycle nobody could mine: the filter has never been bought through Recall. Said out loud, it counts.
    id: 'f9',
    household: DEMO_HOUSEHOLD_ID,
    scope: 'household',
    owner: DEMO_HOUSEHOLD_ID,
    type: 'procedural',
    content: 'We replace the fridge water filter every 3 months',
    confidence: 0.9,
    tag: 'none',
    origin: 'seed',
  },
] as const;

const devices = [
  { id: 'kitchen-echo', name: 'Kitchen Echo Show', location: 'Kitchen', primary: null },
  { id: 'bedroom-echo', name: "Ruth's Echo", location: "Ruth's room", primary: DEMO_PEOPLE.som },
  { id: 'living-firetv', name: 'Living room Fire TV', location: 'Living room', primary: null },
  // Worn, not spoken to: it reports heart rate and movement, and only derived context is kept.
  { id: 'ruth-bee', name: "Ruth's Bee", location: 'Worn', primary: DEMO_PEOPLE.som },
  { id: 'emma-watch', name: "Emma's watch", location: 'Worn', primary: DEMO_PEOPLE.emma },
];

// Past purchases, so "what did I buy last time?" and "what are we due for?" have something to answer
// from. Weekly wet food, coffee every fortnight, and one of Daniel's own — which Emma must not see.
// `days` counts back from whenever the seed runs, so the cycles stay true however long the demo sits.
const PURCHASES: { person: string | null; venue: string; item: string; amount: number; days: number[] }[] = [
  { person: null, venue: 'Chewy', item: 'wet food (12 pouches)', amount: 23.4, days: [4, 11, 18, 25, 32] },
  { person: null, venue: 'Blue Bottle', item: 'coffee beans', amount: 18.0, days: [21, 35, 49] },
  { person: null, venue: 'Target', item: 'AA batteries', amount: 12.99, days: [40, 130] },
  // Bought once. No cycle is mineable from one purchase — the cycle comes from what Emma said.
  { person: null, venue: 'Home Depot', item: 'fridge water filter', amount: 49.99, days: [100] },
  { person: DEMO_PEOPLE.daniel, venue: 'GNC', item: 'protein powder', amount: 44.0, days: [6, 34, 62] },
];

// Everything below exists so that every console page has something real on it. Facts, devices and
// purchases were already seeded; rules, routines, care and context were not, so a fresh database
// showed four empty pages — which is exactly the part of the product that is hardest to describe
// without seeing it.

const RULES: {
  author: string;
  role: MembershipRole;
  scope: 'person' | 'household' | 'device';
  scopeId: string;
  text: string;
  effect: 'block' | 'require_confirm' | 'suppress_offer' | 'prefer';
  severity: 'safety' | 'hard' | 'soft';
  intents: string[];
  topics: string[];
  condition?: Partial<{ time_from: string; time_to: string; school_nights: boolean }>;
}[] = [
  {
    author: DEMO_PEOPLE.emma,
    role: 'owner',
    scope: 'household',
    scopeId: DEMO_HOUSEHOLD_ID,
    text: 'No music after 10pm on school nights',
    effect: 'block',
    severity: 'hard',
    intents: ['media.play'],
    topics: [],
    condition: { time_from: '22:00', time_to: '06:00', school_nights: true },
  },
  {
    author: DEMO_PEOPLE.emma,
    role: 'owner',
    scope: 'household',
    scopeId: DEMO_HOUSEHOLD_ID,
    text: 'Never suggest anything with peanuts',
    effect: 'block',
    severity: 'safety',
    intents: ['recipe', 'order.food'],
    topics: ['peanut', 'peanuts'],
  },
  {
    author: DEMO_PEOPLE.daniel,
    role: 'adult',
    scope: 'person',
    scopeId: DEMO_PEOPLE.daniel,
    text: 'Always check with me before ordering anything',
    effect: 'require_confirm',
    severity: 'hard',
    intents: ['order.food', 'purchase'],
    topics: [],
  },
  {
    author: DEMO_PEOPLE.nina,
    role: 'caregiver',
    scope: 'person',
    scopeId: DEMO_PEOPLE.som,
    text: "Don't bring up the news unprompted with Ruth",
    effect: 'suppress_offer',
    severity: 'safety',
    intents: ['suggestion', 'notification'],
    topics: ['news'],
  },
];

/** Mined routines, with the activity behind them, so the page shows working ones and a broken one. */
const ROUTINES: {
  person: string | null;
  kind: string;
  days: 'daily' | 'weekdays' | 'weekends';
  minute: number;
  spread: number;
  status: 'candidate' | 'active';
  health: 'ok' | 'fading' | 'broken';
  reason?: string;
  /** How many of the last 21 days it actually happened on. */
  seen: number;
}[] = [
  {
    person: DEMO_PEOPLE.emma,
    kind: 'coffee.brew',
    days: 'weekdays',
    minute: 430,
    spread: 12,
    status: 'active',
    health: 'ok',
    seen: 15,
  },
  {
    person: DEMO_PEOPLE.som,
    kind: 'checkin.morning',
    days: 'daily',
    minute: 480,
    spread: 15,
    status: 'active',
    health: 'ok',
    seen: 20,
  },
  {
    person: null,
    kind: 'dinner.start',
    days: 'weekdays',
    minute: 1170,
    spread: 20,
    status: 'active',
    health: 'ok',
    seen: 14,
  },
  // Stopped happening a week ago. The console says so rather than quietly dropping it.
  {
    person: DEMO_PEOPLE.emma,
    kind: 'news.play',
    days: 'weekdays',
    minute: 445,
    spread: 10,
    status: 'active',
    health: 'broken',
    reason: 'Not seen for 8 days',
    seen: 6,
  },
  // Seen enough to notice, not enough to act on: the first occurrence is an offer, never an action.
  {
    person: DEMO_PEOPLE.daniel,
    kind: 'workout.start',
    days: 'weekdays',
    minute: 1080,
    spread: 25,
    status: 'candidate',
    health: 'ok',
    seen: 7,
  },
];

/** Ruth's care plan: what a caregiver entered, and the doses actually confirmed or missed. */
const CARE_POLICIES: { topic: string; keywords: string[]; policy: 'correct' | 'redirect'; guidance: string }[] = [
  {
    topic: 'Arthur',
    keywords: ['arthur', 'husband'],
    policy: 'redirect',
    guidance:
      "Arthur died in 2019. Don't correct her. Say he isn't here right now, and ask about the garden they kept.",
  },
  {
    topic: 'driving',
    keywords: ['car', 'drive', 'driving'],
    policy: 'redirect',
    guidance: 'The car was sold. Offer to arrange a lift instead.',
  },
];

const CARE_REMINDERS: { label: string; dose: string; times: number[]; kind: 'medication' | 'meal' }[] = [
  { label: 'Morning tablets', dose: '1 tablet with food', times: [510], kind: 'medication' },
  { label: 'Evening tablets', dose: '2 tablets', times: [1200], kind: 'medication' },
  { label: 'Lunch', dose: '', times: [750], kind: 'meal' },
];

export async function seed(databaseUrl: string, devToken: string | undefined): Promise<void> {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query('BEGIN');
    for (const h of households) {
      await client.query(
        // Region and timezone must converge too. They did not, and a database seeded before the
        // move to US regions stayed on Asia/Kuala_Lumpur for good: US holidays never matched, and
        // every local time in the demo was read in the wrong zone.
        `INSERT INTO household (id, name, region, timezone) VALUES ($1, $2, 'us', $3)
         ON CONFLICT (id) DO UPDATE SET
           name = EXCLUDED.name, region = EXCLUDED.region, timezone = EXCLUDED.timezone`,
        [h.id, h.name, DEMO_TIMEZONE],
      );
      // Child rows carry their own copy of the region for residency, so they move with it.
      for (const table of [
        'fact',
        'rule',
        'device',
        'action',
        'activity',
        'routine',
        'notice',
        'event',
        'household_token',
      ]) {
        await client.query(`UPDATE ${table} SET region = 'us' WHERE household_id = $1 AND region <> 'us'`, [h.id]);
      }
    }
    for (const p of people) {
      await client.query(
        `INSERT INTO person (id, display_name, email) VALUES ($1, $2, $3)
         ON CONFLICT (id) DO UPDATE SET display_name = EXCLUDED.display_name, email = EXCLUDED.email`,
        [p.id, p.name, p.email],
      );
    }
    for (const m of memberships) {
      await client.query(
        `INSERT INTO membership (household_id, person_id, role, grants, granted_by)
         SELECT $1, $2, $3, $4, $5
         WHERE NOT EXISTS (SELECT 1 FROM membership WHERE household_id = $1 AND person_id = $2 AND revoked_at IS NULL)`,
        [m.household, m.person, m.role, [...m.grants], DEMO_PEOPLE.emma],
      );
      await client.query(
        'UPDATE membership SET role = $3, grants = $4 WHERE household_id = $1 AND person_id = $2 AND revoked_at IS NULL',
        [m.household, m.person, m.role, [...m.grants]],
      );
    }
    for (const f of facts) {
      await client.query(
        `INSERT INTO fact (id, household_id, region, scope_type, scope_id, type, content, source, confidence, sensitivity_tag)
         VALUES ($1, $2, 'us', $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (id) DO NOTHING`,
        [
          `00000000-0000-4000-8000-0000000000${f.id}`,
          f.household,
          f.scope,
          f.owner,
          f.type,
          f.content,
          JSON.stringify(
            f.origin === 'caregiver' ? { origin: 'caregiver', entered_by: DEMO_PEOPLE.nina } : { origin: 'seed' },
          ),
          f.confidence,
          f.tag,
        ],
      );
    }
    // Seeded purchases are replaced rather than added to, so re-running the seed keeps the cycles honest.
    await client.query(`DELETE FROM action WHERE household_id = $1 AND details->>'seed' = 'true'`, [DEMO_HOUSEHOLD_ID]);
    for (const p of PURCHASES) {
      for (const days of p.days) {
        await client.query(
          `INSERT INTO action (household_id, region, person_id, intent, summary, topics, details, status, decided_at)
           VALUES ($1, 'us', $2, 'purchase', $3, ARRAY['shopping'], $4, 'executed', now() - ($5 || ' days')::interval)`,
          [
            DEMO_HOUSEHOLD_ID,
            p.person,
            `Order ${p.item} from ${p.venue}`,
            JSON.stringify({ venue: p.venue, amount: p.amount, currency: 'USD', items: [p.item], seed: true }),
            String(days),
          ],
        );
      }
    }
    // Rules, routines, care and context: replaced wholesale each run so the demo is the same twice.
    await client.query(`DELETE FROM care_reminder_log WHERE household_id = $1`, [DEMO_HOUSEHOLD_ID]);
    for (const table of ['rule', 'care_reminder', 'care_policy', 'notice', 'activity', 'routine', 'context_baseline']) {
      await client.query(`DELETE FROM ${table} WHERE household_id = $1`, [DEMO_HOUSEHOLD_ID]);
    }

    for (const r of RULES) {
      await client.query(
        `INSERT INTO rule (household_id, region, author_id, author_role, scope_type, scope_id, text, effect,
                           severity, subject, condition)
         VALUES ($1, 'us', $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          DEMO_HOUSEHOLD_ID,
          r.author,
          r.role,
          r.scope,
          r.scopeId,
          r.text,
          r.effect,
          r.severity,
          JSON.stringify({ intents: r.intents, topics: r.topics }),
          JSON.stringify({
            time_from: null,
            time_to: null,
            days: null,
            school_nights: false,
            devices: null,
            contexts: null,
            ...r.condition,
          }),
        ],
      );
    }

    // The activity a routine was mined from, so the numbers on the page are not decoration: if you
    // re-run the miner against this database it finds the same routines.
    for (const r of ROUTINES) {
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO routine (household_id, region, person_id, kind, days, center_minute, spread_minutes,
                              support, confidence, last_seen, status, health, health_reason, accepted)
         VALUES ($1, 'us', $2, $3, $4, $5, $6, $7, $8, (now() - ($9 || ' days')::interval)::date, $10, $11, $12, $13)
         RETURNING id`,
        [
          DEMO_HOUSEHOLD_ID,
          r.person,
          r.kind,
          r.days,
          r.minute,
          r.spread,
          Math.round((r.seen / 21) * 100) / 100,
          Math.round((r.seen / 21) * (r.health === 'broken' ? 0.6 : 0.95) * 100) / 100,
          String(r.health === 'broken' ? 8 : 0),
          r.status,
          r.health,
          r.reason ?? null,
          r.status === 'active' ? 2 : 0,
        ],
      );
      const routineId = rows[0]?.id;
      for (let day = 1; day <= 21 && 21 - day < r.seen * 2; day++) {
        if (r.health === 'broken' && day <= 8) continue; // it stopped a week ago
        const minute = r.minute + Math.round((day % 5) - 2) * Math.max(1, Math.round(r.spread / 2));
        await client.query(
          `INSERT INTO activity (household_id, region, person_id, kind, device_id, local_date, local_minute, ok, at)
           VALUES ($1, 'us', $2, $3, $4, (now() - ($5 || ' days')::interval)::date, $6, true,
                   now() - ($5 || ' days')::interval)`,
          [
            DEMO_HOUSEHOLD_ID,
            r.person,
            r.kind,
            r.person === DEMO_PEOPLE.som ? 'bedroom-echo' : 'kitchen-echo',
            String(day),
            minute,
          ],
        );
      }
      if (routineId && r.kind === 'checkin.morning') {
        // Ruth checked in this morning, so the care page opens on a good day rather than an alert.
        await client.query(
          `INSERT INTO notice (household_id, region, person_id, kind, audience, text, dedupe_key, created_at)
           VALUES ($1, 'us', $2, 'checkin', 'carers', $3, $4, now() - interval '4 hours')
           ON CONFLICT (household_id, dedupe_key) DO NOTHING`,
          [DEMO_HOUSEHOLD_ID, DEMO_PEOPLE.som, 'Ruth checked in at 8:05am.', `checkin:seed:${routineId}`],
        );
      }
    }

    for (const c of CARE_POLICIES) {
      await client.query(
        `INSERT INTO care_policy (household_id, region, person_id, topic, keywords, policy, guidance, author_id)
         VALUES ($1, 'us', $2, $3, $4, $5, $6, $7)`,
        [DEMO_HOUSEHOLD_ID, DEMO_PEOPLE.som, c.topic, c.keywords, c.policy, c.guidance, DEMO_PEOPLE.nina],
      );
    }

    for (const m of CARE_REMINDERS) {
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO care_reminder (household_id, region, person_id, kind, label, dose, times, days, device_id, author_id)
         VALUES ($1, 'us', $2, $3, $4, $5, $6, 'daily', 'bedroom-echo', $7) RETURNING id`,
        [DEMO_HOUSEHOLD_ID, DEMO_PEOPLE.som, m.kind, m.label, m.dose || null, m.times, DEMO_PEOPLE.nina],
      );
      const reminderId = rows[0]?.id;
      if (!reminderId) continue;
      // Six days of history plus however much of today has already happened, so the caregiver view
      // opens on a day in progress. Mostly taken, one missed, so the shape is real rather than tidy.
      // Dates and times are worked out in the household's own zone, not the database session's.
      for (let day = 6; day >= 0; day--) {
        const missed = day === 3 && m.kind === 'medication';
        for (const minute of m.times) {
          await client.query(
            `INSERT INTO care_reminder_log (household_id, region, reminder_id, person_id, local_date, local_minute,
                                            due_at, status, prompted_at, escalated_at, confirmed_at, confirmed_by, how)
             SELECT $1, 'us', $2, $3, ld, $5::smallint, due, $6, due,
                    CASE WHEN $6 = 'missed' THEN due + interval '30 minutes' END,
                    CASE WHEN $6 = 'confirmed' THEN due + interval '4 minutes' END,
                    $7, $8
               FROM (
                 SELECT ld, timezone($9, ld + ($5::text || ' minutes')::interval) AS due
                   FROM (SELECT (timezone($9, now()))::date - $4::int AS ld) d
               ) t
              WHERE due < now()
             ON CONFLICT (reminder_id, due_at) DO NOTHING`,
            [
              DEMO_HOUSEHOLD_ID,
              reminderId,
              DEMO_PEOPLE.som,
              String(day),
              minute,
              missed ? 'missed' : 'confirmed',
              missed ? null : DEMO_PEOPLE.som,
              missed ? null : 'voice',
              DEMO_TIMEZONE,
            ],
          );
        }
      }
    }

    // Ruth's day so far, and what her Bee last reported. Readings and times only: Recall records a
    // number and never turns it into a diagnosis, which is the whole point of showing them plainly.
    await client.query(`DELETE FROM event WHERE household_id = $1 AND payload ? 'seed'`, [DEMO_HOUSEHOLD_ID]);
    for (const [kind, field, value, minutesAgo] of [
      ['hr.sample', 'bpm', 74, 6],
      ['phone.motion', 'steps_per_min', 41, 18],
    ] as const) {
      await client.query(
        // occurred_at is generated from the HLC's wall clock, so the timestamp goes in the HLC.
        `INSERT INTO event (event_id, household_id, region, hlc, device_id, person_id, kind, payload, sensitive,
                            received_at)
         SELECT gen_random_uuid(), $1, 'us',
                lpad((extract(epoch from t) * 1000)::bigint::text, 13, '0') || '-00000-seed',
                'ruth-bee', $2, $3, $4, true, t
           FROM (SELECT now() - ($5 || ' minutes')::interval AS t) x`,
        [DEMO_HOUSEHOLD_ID, DEMO_PEOPLE.som, kind, JSON.stringify({ [field]: value, seed: true }), String(minutesAgo)],
      );
    }
    // A day with a shape to it, so the caregiver view is a timeline rather than a single dot.
    for (const [kind, minutesAgo] of [
      ['checkin.morning', 330],
      ['kettle.on', 320],
      ['radio.play', 250],
      ['lunch.start', 80],
    ] as const) {
      await client.query(
        `INSERT INTO activity (household_id, region, person_id, kind, device_id, local_date, local_minute, ok, at)
         SELECT $1, 'us', $2, $3, 'bedroom-echo', (timezone($5, t))::date,
                extract(hour from timezone($5, t)) * 60 + extract(minute from timezone($5, t)), true, t
           FROM (SELECT now() - ($4 || ' minutes')::interval AS t) x`,
        [DEMO_HOUSEHOLD_ID, DEMO_PEOPLE.som, kind, String(minutesAgo), DEMO_TIMEZONE],
      );
    }

    // What a worn tracker has learned about each person, so the context page has real thresholds
    // rather than defaults. Readings only — Recall never turns a number into a diagnosis.
    for (const [person, resting, ratio] of [
      [DEMO_PEOPLE.som, 72, 1.35],
      [DEMO_PEOPLE.emma, 61, 1.55],
    ] as const) {
      await client.query(
        `INSERT INTO context_baseline (household_id, region, person_id, resting_hr, workout_ratio, manual_samples)
         VALUES ($1, 'us', $2, $3, $4, 3)
         ON CONFLICT (household_id, person_id) DO UPDATE SET resting_hr = EXCLUDED.resting_hr,
           workout_ratio = EXCLUDED.workout_ratio`,
        [DEMO_HOUSEHOLD_ID, person, resting, ratio],
      );
    }

    // The hackathon build keeps 7 days of raw events so compaction actually runs (architecture.md §4.1).
    await client.query('UPDATE household SET retention_days = 7 WHERE id = ANY($1)', [households.map((h) => h.id)]);
    for (const d of devices) {
      await client.query(
        `INSERT INTO device (household_id, device_id, region, name, location, primary_person_id)
         VALUES ($1, $2, 'us', $3, $4, $5)
         ON CONFLICT (household_id, device_id) DO UPDATE SET
           name = EXCLUDED.name, location = EXCLUDED.location, primary_person_id = EXCLUDED.primary_person_id`,
        [DEMO_HOUSEHOLD_ID, d.id, d.name, d.location, d.primary],
      );
    }
    // One fact erased for good, so "forget" has something to show and the count is not zero.
    await client.query(
      `INSERT INTO fact (id, household_id, region, scope_type, scope_id, type, content, source, confidence,
                         sensitivity_tag, forgotten_at)
       VALUES ($1, $2, 'us', 'person', $3, 'semantic', 'Emma is training for a half marathon',
               '{"origin":"seed"}', 0.8, 'none', now() - interval '2 days')
       ON CONFLICT (id) DO NOTHING`,
      ['00000000-0000-4000-8000-0000000000fb', DEMO_HOUSEHOLD_ID, DEMO_PEOPLE.emma],
    );
    // Seeded facts need fact.created events too, or a device syncing from zero wouldn't see them.
    await client.query('SELECT recall_backfill_fact_events()');
    if (devToken) {
      // Lets .mcp.json and the smoke script keep using RECALL_DEV_TOKEN against the demo household.
      await client.query(
        `INSERT INTO household_token (household_id, region, token_hash, label, created_by)
         VALUES ($1, 'us', $2, 'dev (RECALL_DEV_TOKEN)', $3)
         ON CONFLICT (token_hash) DO NOTHING`,
        [DEMO_HOUSEHOLD_ID, hashToken(devToken), DEMO_PEOPLE.emma],
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    await client.end();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  loadDotEnv();
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');
  await seed(url, process.env.RECALL_DEV_TOKEN || undefined);
  console.log('seeded demo households');
}
