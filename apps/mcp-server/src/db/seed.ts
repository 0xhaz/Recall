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
] as const;

const devices = [
  { id: 'kitchen-echo', name: 'Kitchen Echo Show', location: 'Kitchen', primary: null },
  { id: 'bedroom-echo', name: "Ruth's Echo", location: "Ruth's room", primary: DEMO_PEOPLE.som },
  { id: 'living-firetv', name: 'Living room Fire TV', location: 'Living room', primary: null },
  // Worn, not spoken to: it reports heart rate and movement, and only derived context is kept.
  { id: 'ruth-bee', name: "Ruth's Bee", location: 'Worn', primary: DEMO_PEOPLE.som },
  { id: 'emma-watch', name: "Emma's watch", location: 'Worn', primary: DEMO_PEOPLE.emma },
];

export async function seed(databaseUrl: string, devToken: string | undefined): Promise<void> {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query('BEGIN');
    for (const h of households) {
      await client.query(
        `INSERT INTO household (id, name, region, timezone) VALUES ($1, $2, 'us', 'America/New_York')
         ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name`,
        [h.id, h.name],
      );
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
