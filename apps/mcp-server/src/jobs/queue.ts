import type { Queryable } from '../db/db.js';

export const JOBS_CHANNEL = 'recall_jobs';

export type JobKind = 'extract' | 'maintain' | 'embed' | 'mine' | 'context' | 'presence';

/** Enqueue inside the caller's transaction; the NOTIFY is only delivered if it commits. */
export async function enqueue(
  q: Queryable,
  householdId: string,
  kind: JobKind,
  payload: Record<string, unknown>,
): Promise<void> {
  await q.query('INSERT INTO job (household_id, kind, payload) VALUES ($1, $2, $3)', [
    householdId,
    kind,
    JSON.stringify(payload),
  ]);
  await q.query('SELECT pg_notify($1, $2)', [JOBS_CHANNEL, kind]);
}

/** Enqueue unless the same kind is already waiting for this household (a burst of reports needs one run). */
export async function enqueueOnce(q: Queryable, householdId: string, kind: JobKind): Promise<void> {
  const { rowCount } = await q.query(
    `INSERT INTO job (household_id, kind, payload)
     SELECT $1, $2, '{}' WHERE NOT EXISTS (
       SELECT 1 FROM job WHERE household_id = $1 AND kind = $2 AND status = 'queued')`,
    [householdId, kind],
  );
  if (rowCount) await q.query('SELECT pg_notify($1, $2)', [JOBS_CHANNEL, kind]);
}
