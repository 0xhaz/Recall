import { Inject, Injectable } from '@nestjs/common';
import { audit } from '../audit.js';
import { Db } from '../db/db.js';
import { lockHousehold } from '../events/event-log.service.js';
import { buildSnapshot } from '../events/snapshot.js';
import { Eraser } from '../memory/eraser.js';

// Retention rules (architecture.md §4.1).
const TOMBSTONE_GRACE_DAYS = 30;
const SENSITIVE_RETENTION_DAYS = 7;
const DONE_JOB_RETENTION_DAYS = 7;
const DEPARTED_GRACE_DAYS = 30;
const ACTIVITY_RETENTION_DAYS = 60;
const KEEP_SNAPSHOTS = 2;

export interface MaintenanceReport {
  snapshot_seq: number;
  events_compacted: number;
  sensitive_deleted: number;
  tombstones_expired: number;
  utterances_deleted: number;
  sessions_deleted: number;
}

@Injectable()
export class MaintenanceService {
  constructor(
    @Inject(Db) private readonly db: Db,
    @Inject(Eraser) private readonly eraser: Eraser,
  ) {}

  /** Record every projection as of the latest event. */
  async snapshot(householdId: string): Promise<number> {
    return this.db.transaction(async (tx) => {
      await lockHousehold(tx, householdId);
      const state = await buildSnapshot(tx, householdId);
      await tx.query(
        `INSERT INTO snapshot (household_id, seq, data) VALUES ($1, $2, $3)
         ON CONFLICT (household_id, seq) DO UPDATE SET data = EXCLUDED.data, created_at = now()`,
        [householdId, state.cursor, JSON.stringify(state)],
      );
      return state.cursor;
    });
  }

  /**
   * Nightly: snapshot, then drop raw events past retention that the snapshot covers. Tombstones
   * outlive retention by 30 days so a stale device can't resurrect what was forgotten.
   */
  async maintain(householdId: string): Promise<MaintenanceReport> {
    const snapshotSeq = await this.snapshot(householdId);

    return this.db.transaction(async (tx) => {
      await lockHousehold(tx, householdId);
      const { rows } = await tx.query<{ retention_days: number }>(
        'SELECT retention_days FROM household WHERE id = $1',
        [householdId],
      );
      const retention = rows[0]?.retention_days;
      if (!retention) throw new Error(`Household ${householdId} not found`);

      const compacted = await tx.query<{ max: string | null; count: string }>(
        `WITH gone AS (
           DELETE FROM event
            WHERE household_id = $1 AND seq <= $2
              AND received_at < now() - make_interval(days => $3)
              AND NOT (tombstone AND received_at >= now() - make_interval(days => $3 + ${TOMBSTONE_GRACE_DAYS}))
           RETURNING seq)
         SELECT max(seq) AS max, count(*) AS count FROM gone`,
        [householdId, snapshotSeq, retention],
      );
      const compactedThrough = compacted.rows[0]?.max;
      if (compactedThrough) {
        // Devices at or below this cursor now re-sync from the snapshot instead of replaying.
        await tx.query('UPDATE household SET compacted_through = GREATEST(compacted_through, $2) WHERE id = $1', [
          householdId,
          compactedThrough,
        ]);
      }

      const sensitive = await tx.query(
        `DELETE FROM event WHERE household_id = $1 AND sensitive
            AND received_at < now() - make_interval(days => ${SENSITIVE_RETENTION_DAYS})`,
        [householdId],
      );

      // A tombstone's fact row goes once the grace period is over (its content was erased when forgotten).
      const expired = `SELECT id FROM fact WHERE household_id = $1
                          AND forgotten_at < now() - make_interval(days => $2 + ${TOMBSTONE_GRACE_DAYS})`;
      await tx.query(`UPDATE fact SET superseded_by = NULL WHERE superseded_by IN (${expired})`, [
        householdId,
        retention,
      ]);
      const tombstones = await tx.query(`DELETE FROM fact WHERE id IN (${expired})`, [householdId, retention]);

      const utterances = await tx.query(
        `DELETE FROM utterance WHERE household_id = $1 AND status <> 'pending'
            AND created_at < now() - make_interval(days => $2)`,
        [householdId, retention],
      );
      const sessions = await tx.query(
        'DELETE FROM session WHERE household_id = $1 AND last_turn_at < now() - make_interval(days => $2)',
        [householdId, retention],
      );
      await tx.query(
        `DELETE FROM job WHERE household_id = $1 AND status = 'done'
            AND created_at < now() - make_interval(days => ${DONE_JOB_RETENTION_DAYS})`,
        [householdId],
      );
      await tx.query(
        `DELETE FROM snapshot WHERE household_id = $1
            AND seq NOT IN (SELECT seq FROM snapshot WHERE household_id = $1 ORDER BY seq DESC LIMIT ${KEEP_SNAPSHOTS})`,
        [householdId],
      );
      // Activity is derived data: kept long enough to mine four-week routines, then dropped.
      await tx.query(
        `DELETE FROM activity WHERE household_id = $1 AND local_date < current_date - ${ACTIVITY_RETENTION_DAYS}`,
        [householdId],
      );
      await tx.query('DELETE FROM notice WHERE household_id = $1 AND created_at < now() - make_interval(days => $2)', [
        householdId,
        retention,
      ]);

      return {
        snapshot_seq: snapshotSeq,
        events_compacted: Number(compacted.rows[0]?.count ?? 0),
        sensitive_deleted: sensitive.rowCount ?? 0,
        tombstones_expired: tombstones.rowCount ?? 0,
        utterances_deleted: utterances.rowCount ?? 0,
        sessions_deleted: sessions.rowCount ?? 0,
      };
    });
  }

  /** Queue daily maintenance, and embedding backfill for facts that have none yet. */
  async schedule(): Promise<number> {
    const maintain = await this.db.query(
      `INSERT INTO job (household_id, kind, payload)
       SELECT h.id, 'maintain', '{}' FROM household h
        WHERE NOT EXISTS (SELECT 1 FROM snapshot s WHERE s.household_id = h.id AND s.created_at > now() - interval '1 day')
          AND NOT EXISTS (SELECT 1 FROM job j WHERE j.household_id = h.id AND j.kind = 'maintain'
                                              AND j.status IN ('queued', 'running'))`,
    );
    const embed = await this.db.query(
      `INSERT INTO job (household_id, kind, payload)
       SELECT DISTINCT f.household_id, 'embed', '{}'::jsonb FROM fact f
        WHERE f.embedding IS NULL AND f.forgotten_at IS NULL AND f.content <> ''
          AND NOT EXISTS (SELECT 1 FROM job j WHERE j.household_id = f.household_id AND j.kind = 'embed'
                                              AND j.status IN ('queued', 'running'))`,
    );
    const mine = await this.db.query(
      `INSERT INTO job (household_id, kind, payload)
       SELECT DISTINCT a.household_id, 'mine', '{}'::jsonb FROM activity a
        WHERE NOT EXISTS (SELECT 1 FROM job j WHERE j.household_id = a.household_id AND j.kind = 'mine'
                            AND (j.status IN ('queued', 'running') OR j.created_at > now() - interval '20 hours'))`,
    );
    return (maintain.rowCount ?? 0) + (embed.rowCount ?? 0) + (mine.rowCount ?? 0);
  }

  /** People with no membership for 30 days (departed guests, "forget me") are removed entirely. */
  async purgeDeparted(): Promise<number> {
    const { rows } = await this.db.query<{ id: string }>(
      `SELECT p.id FROM person p
        WHERE p.created_at < now() - make_interval(days => ${DEPARTED_GRACE_DAYS})
          AND NOT EXISTS (
            SELECT 1 FROM membership m WHERE m.person_id = p.id
               AND (m.revoked_at IS NULL OR m.revoked_at > now() - make_interval(days => ${DEPARTED_GRACE_DAYS})))`,
    );
    for (const { id } of rows) await this.purgePerson(id);
    return rows.length;
  }

  private async purgePerson(personId: string): Promise<void> {
    // Anything still on record is tombstoned first, so devices drop it too.
    const { rows: households } = await this.db.query<{ household_id: string }>(
      `SELECT DISTINCT household_id FROM fact WHERE scope_type = 'person' AND scope_id = $1 AND forgotten_at IS NULL`,
      [personId],
    );
    for (const { household_id: householdId } of households) {
      await this.db.transaction(async (tx) => {
        await lockHousehold(tx, householdId);
        const { rows: facts } = await tx.query<{ id: string }>(
          `SELECT id FROM fact WHERE household_id = $1 AND scope_type = 'person' AND scope_id = $2 AND forgotten_at IS NULL`,
          [householdId, personId],
        );
        await this.eraser.forgetFacts(
          tx,
          householdId,
          facts.map((f) => f.id),
          null,
        );
      });
    }

    await this.db.transaction(async (tx) => {
      const own = `SELECT id FROM fact WHERE scope_type = 'person' AND scope_id = $1`;
      await tx.query(`UPDATE fact SET superseded_by = NULL WHERE superseded_by IN (${own})`, [personId]);
      await tx.query(`DELETE FROM fact WHERE id IN (${own})`, [personId]);
      await tx.query('DELETE FROM utterance WHERE person_id = $1', [personId]);
      for (const [table, column] of [
        ['event', 'person_id'],
        ['session', 'person_id'],
        ['membership', 'granted_by'],
        ['household_token', 'created_by'],
        ['audit_log', 'actor_id'],
        ['device', 'primary_person_id'],
        ['rule', 'author_id'],
        ['rule', 'removed_by'],
        ['notice', 'person_id'],
        ['notice', 'acknowledged_by'],
      ] as const) {
        await tx.query(`UPDATE ${table} SET ${column} = NULL WHERE ${column} = $1`, [personId]);
      }
      for (const table of [
        'activity',
        'routine',
        'context_state',
        'context_baseline',
        'track_affinity',
        'login_token',
        'console_session',
        'membership',
      ] as const) {
        await tx.query(`DELETE FROM ${table} WHERE person_id = $1`, [personId]);
      }
      await tx.query('DELETE FROM person WHERE id = $1', [personId]);
      await audit(tx, {
        householdId: null,
        actorId: null,
        action: 'person.purged',
        targetType: 'person',
        targetId: personId,
      });
    });
  }
}
