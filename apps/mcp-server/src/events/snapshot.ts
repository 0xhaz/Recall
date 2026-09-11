import type { FactView, ProjectionState, RuleView } from '@recall/core';
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
  const { rows: rules } = await tx.query<{ id: string; view: RuleView }>(
    'SELECT id, view FROM rule_view WHERE household_id = $1 AND removed_at IS NULL',
    [householdId],
  );
  // Tombstones travel with the snapshot so a stale replay can't resurrect a forgotten fact or removed rule.
  const { rows: tombstones } = await tx.query<{ id: string; hlc: string; reason: 'forgotten' | 'removed' }>(
    `SELECT id, hlc, 'forgotten' AS reason FROM fact
      WHERE household_id = $1 AND forgotten_at IS NOT NULL AND hlc IS NOT NULL
     UNION ALL
     SELECT id, hlc, 'removed' FROM rule
      WHERE household_id = $1 AND removed_at IS NOT NULL AND hlc IS NOT NULL`,
    [householdId],
  );

  return {
    cursor: Number(last[0]?.seq ?? 0),
    facts: Object.fromEntries(facts.map((f) => [f.id, f.view])),
    rules: Object.fromEntries(rules.map((r) => [r.id, r.view])),
    removed: Object.fromEntries(tombstones.map((t) => [t.id, { hlc: t.hlc, reason: t.reason }])),
  };
}
