import type { Queryable } from '../db/db.js';

/** Kinds that feed the context engine; a report of one queues a re-evaluation. */
export const CONTEXT_SIGNAL_KIND = /^(hr|phone|lights|sound|sleep|door|ring|presence)\.|^session\.turn$/;

export const LISTENING_KIND = /^media\.(play|skip|complete)$/;

/**
 * Plays, skips and finishes count towards the contexts active at the time, for that person
 * (architecture.md §3.1): skipping a track mid-workout says nothing about it at bedtime.
 */
export async function recordListening(
  tx: Queryable,
  l: { householdId: string; region: string; personId: string; kind: string; trackId: string; at: Date },
): Promise<void> {
  const column = l.kind === 'media.skip' ? 'skips' : l.kind === 'media.complete' ? 'completes' : 'plays';
  await tx.query(
    `INSERT INTO track_affinity (household_id, region, person_id, context, track_id, ${column}, last_played_at)
     SELECT $1, $2, $3, cs.context, $4, 1, $5 FROM context_state cs
      WHERE cs.household_id = $1 AND cs.active AND (cs.person_key = '' OR cs.person_key = $6)
     ON CONFLICT (household_id, person_id, context, track_id) DO UPDATE SET
       ${column} = track_affinity.${column} + 1,
       last_played_at = GREATEST(track_affinity.last_played_at, EXCLUDED.last_played_at)`,
    [l.householdId, l.region, l.personId, l.trackId, l.at, l.personId],
  );
}
