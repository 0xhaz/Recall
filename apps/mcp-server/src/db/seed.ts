import { pathToFileURL } from 'node:url';
import pg from 'pg';
import { loadDotEnv } from '../env.js';
import { DEMO_HOUSEHOLD_ID, DEMO_PEOPLE } from './seed-ids.js';

// Week-1 demo household: enough to exercise scoped recall (design.md §7, 0:30–1:30 beat).
// The full demo seed for both directions lands in scripts/seed in week 2.

const people = [
  { id: DEMO_PEOPLE.aisyah, name: 'Aisyah', role: 'owner' },
  { id: DEMO_PEOPLE.daniel, name: 'Daniel', role: 'adult' },
  { id: DEMO_PEOPLE.sofia, name: 'Sofia', role: 'child' },
] as const;

const facts = [
  {
    id: 'f1',
    scope: 'person',
    owner: DEMO_PEOPLE.aisyah,
    type: 'semantic',
    content: 'Aisyah is vegetarian',
    confidence: 0.95,
    tag: 'none',
  },
  {
    id: 'f2',
    scope: 'person',
    owner: DEMO_PEOPLE.daniel,
    type: 'semantic',
    content: 'Daniel likes very spicy food',
    confidence: 0.9,
    tag: 'none',
  },
  {
    id: 'f3',
    scope: 'person',
    owner: DEMO_PEOPLE.sofia,
    type: 'semantic',
    content: 'Sofia is allergic to peanuts',
    confidence: 0.99,
    tag: 'health',
  },
  {
    id: 'f4',
    scope: 'household',
    owner: DEMO_HOUSEHOLD_ID,
    type: 'semantic',
    content: "The family's usual weeknight takeaway is Warung Mak Teh",
    confidence: 0.8,
    tag: 'none',
  },
  {
    id: 'f5',
    scope: 'household',
    owner: DEMO_HOUSEHOLD_ID,
    type: 'procedural',
    content: 'Family dinner is usually around 19:30 on weekdays',
    confidence: 0.7,
    tag: 'none',
  },
] as const;

export async function seed(databaseUrl: string): Promise<void> {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO household (id, name, region, timezone) VALUES ($1, 'Demo household', 'my', 'Asia/Kuala_Lumpur')
       ON CONFLICT (id) DO NOTHING`,
      [DEMO_HOUSEHOLD_ID],
    );
    for (const p of people) {
      await client.query('INSERT INTO person (id, display_name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING', [
        p.id,
        p.name,
      ]);
      await client.query(
        `INSERT INTO membership (household_id, person_id, role, granted_by)
         SELECT $1, $2, $3, $4
         WHERE NOT EXISTS (SELECT 1 FROM membership WHERE household_id = $1 AND person_id = $2 AND revoked_at IS NULL)`,
        [DEMO_HOUSEHOLD_ID, p.id, p.role, DEMO_PEOPLE.aisyah],
      );
    }
    for (const f of facts) {
      await client.query(
        `INSERT INTO fact (id, household_id, region, scope_type, scope_id, type, content, source, confidence, sensitivity_tag)
         VALUES ($1, $2, 'my', $3, $4, $5, $6, '{"origin":"seed"}', $7, $8)
         ON CONFLICT (id) DO NOTHING`,
        [
          `00000000-0000-4000-8000-0000000000${f.id}`,
          DEMO_HOUSEHOLD_ID,
          f.scope,
          f.owner,
          f.type,
          f.content,
          f.confidence,
          f.tag,
        ],
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
  await seed(url);
  console.log('seeded demo household');
}
