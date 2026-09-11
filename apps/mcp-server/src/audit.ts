import type { Queryable } from './db/db.js';

export interface AuditEntry {
  /** Null for person-level actions that span households (sign-in, forget-me). */
  householdId: string | null;
  actorId: string | null;
  action: string;
  targetType: string;
  targetId?: string;
  detail?: Record<string, unknown>;
}

/** Membership, role, grant, token and sign-in changes are all logged (architecture.md §1.3). */
export async function audit(q: Queryable, entry: AuditEntry): Promise<void> {
  await q.query(
    `INSERT INTO audit_log (household_id, region, actor_id, action, target_type, target_id, detail)
     VALUES ($1, (SELECT region FROM household WHERE id = $1), $2, $3, $4, $5, $6)`,
    [
      entry.householdId,
      entry.actorId,
      entry.action,
      entry.targetType,
      entry.targetId ?? null,
      JSON.stringify(entry.detail ?? {}),
    ],
  );
}
