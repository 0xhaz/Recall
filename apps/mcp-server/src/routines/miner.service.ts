import { Inject, Injectable } from '@nestjs/common';
import { MALAYSIA_HOLIDAYS_2026, type MinedRoutine, mineRoutines, type Occurrence, temporalStamp } from '@recall/core';
import { Db } from '../db/db.js';
import { lockHousehold } from '../events/event-log.service.js';

const WINDOW_DAYS = 28;
/** A routine not seen for this long is retired; one seen again comes back as a candidate. */
const RETIRE_AFTER_DAYS = 21;
const MATCH_WITHIN_MIN = 60;

export interface MineReport {
  mined: number;
  inserted: number;
  updated: number;
  faded: number;
}

interface ExistingRoutine {
  id: string;
  person_id: string | null;
  kind: string;
  days: string;
  center_minute: number;
}

@Injectable()
export class RoutineMiner {
  constructor(@Inject(Db) private readonly db: Db) {}

  /** Mine the last four weeks of activity into routines, updating the ones already known. */
  async mine(householdId: string, now: Date = new Date()): Promise<MineReport> {
    const { rows: households } = await this.db.query<{ timezone: string; region: string }>(
      'SELECT timezone, region FROM household WHERE id = $1',
      [householdId],
    );
    const household = households[0];
    if (!household) throw new Error(`Household ${householdId} not found`);
    const today = temporalStamp(household.timezone, now).local_date;

    const { rows: occurrences } = await this.db.query<Occurrence>(
      `SELECT person_id, kind, local_date::text AS local_date, local_minute, ok FROM activity
        WHERE household_id = $1 AND local_date >= $2::date - $3::int AND local_date < $2::date`,
      [householdId, today, WINDOW_DAYS],
    );
    const mined = mineRoutines(occurrences, { today, windowDays: WINDOW_DAYS, holidays: MALAYSIA_HOLIDAYS_2026 });

    return this.db.transaction(async (tx) => {
      await lockHousehold(tx, householdId);
      const { rows: existing } = await tx.query<ExistingRoutine>(
        'SELECT id, person_id, kind, days, center_minute FROM routine WHERE household_id = $1',
        [householdId],
      );
      const matched = new Set<string>();
      let inserted = 0;

      for (const r of mined) {
        const same = existing
          .filter(
            (e) =>
              !matched.has(e.id) &&
              e.person_id === r.person_id &&
              e.kind === r.kind &&
              e.days === r.days &&
              Math.abs(e.center_minute - r.center_minute) <= MATCH_WITHIN_MIN,
          )
          .sort((a, b) => Math.abs(a.center_minute - r.center_minute) - Math.abs(b.center_minute - r.center_minute))[0];
        const values = routineValues(r);
        if (same) {
          matched.add(same.id);
          await tx.query(
            `UPDATE routine SET center_minute = $2, spread_minutes = $3, shifted_from = $4, support = $5, confidence = $6,
                    last_seen = $7, sequence = $8, health = $9, health_reason = $10, updated_at = now(),
                    status = CASE WHEN status = 'retired' THEN 'candidate' ELSE status END
              WHERE id = $1`,
            [same.id, ...values],
          );
        } else {
          await tx.query(
            `INSERT INTO routine (household_id, region, person_id, kind, days, center_minute, spread_minutes, shifted_from,
                                  support, confidence, last_seen, sequence, health, health_reason)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
            [householdId, household.region, r.person_id, r.kind, r.days, ...values],
          );
          inserted++;
        }
      }

      // Known routines that didn't show up this time are fading; after three weeks unseen they retire.
      const unseen = existing.filter((e) => !matched.has(e.id)).map((e) => e.id);
      if (unseen.length > 0) {
        await tx.query(
          `UPDATE routine SET health = 'fading', health_reason = 'not seen lately',
                  confidence = round((confidence * 0.7)::numeric, 2), updated_at = now(),
                  status = CASE WHEN last_seen < $2::date - $3::int THEN 'retired' ELSE status END
            WHERE id = ANY($1::uuid[]) AND status <> 'retired'`,
          [unseen, today, RETIRE_AFTER_DAYS],
        );
      }
      return { mined: mined.length, inserted, updated: matched.size, faded: unseen.length };
    });
  }
}

function routineValues(r: MinedRoutine): unknown[] {
  return [
    r.center_minute,
    r.spread_minutes,
    r.shifted_from,
    r.support,
    r.confidence,
    r.last_seen,
    r.sequence,
    r.health,
    r.health_reason,
  ];
}
