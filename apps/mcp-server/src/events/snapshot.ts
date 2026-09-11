import type { FactView, ProjectionState } from '@recall/core';
import type { Queryable } from '../db/db.js';

/**
 * The projection a device would reach by replaying the whole log, built from the tables.
 * Call inside a transaction holding lockHousehold so no event lands between the reads.
 */
export async function buildSnapshot(tx: Queryable, householdId: string): Promise<ProjectionState> {
  const { rows: last } = await tx.query<{ seq: string }>(
    'SELECT COALESCE(max(seq), 0) AS seq FROM event WHERE household_id = $1',
    [householdId],
  );
  const { rows: facts } = await tx.query<{ id: string; view: FactView }>(
    'SELECT id, view FROM fact_view WHERE household_id = $1 AND valid_to IS NULL',
    [householdId],
  );
  // Tombstones travel with the snapshot so a stale replay can't resurrect a forgotten fact.
  const { rows: forgotten } = await tx.query<{ id: string; hlc: string }>(
    'SELECT id, hlc FROM fact WHERE household_id = $1 AND forgotten_at IS NOT NULL AND hlc IS NOT NULL',
    [householdId],
  );

  return {
    cursor: Number(last[0]?.seq ?? 0),
    facts: Object.fromEntries(facts.map((f) => [f.id, f.view])),
    removed: Object.fromEntries(forgotten.map((f) => [f.id, { hlc: f.hlc, reason: 'forgotten' as const }])),
  };
}
