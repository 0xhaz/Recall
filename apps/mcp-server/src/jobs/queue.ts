import type { Queryable } from '../db/db.js';

export const JOBS_CHANNEL = 'recall_jobs';

export type JobKind = 'extract';

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
