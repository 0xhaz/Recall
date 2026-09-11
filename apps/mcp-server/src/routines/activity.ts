import { temporalStamp } from '@recall/core';
import type { Queryable } from '../db/db.js';

/** Reports that describe state rather than something a person did aren't routine material. */
const NOT_ACTIVITY = /^(session|notification|feature|notice)\.|\.(cancel|stop|pause|done|unsubscribe|disable)$/;

export function isRoutineActivity(kind: string, sensitive: boolean): boolean {
  return !sensitive && !NOT_ACTIVITY.test(kind);
}

export function localMinute(timezone: string, at: Date): { date: string; minute: number } {
  const local = temporalStamp(timezone, at);
  const [hours = 0, minutes = 0] = local.local_time.split(':').map(Number);
  return { date: local.local_date, minute: hours * 60 + minutes };
}

export interface ActivityInput {
  householdId: string;
  region: string;
  personId: string | null;
  kind: string;
  deviceId: string | null;
  at: Date;
  timezone: string;
  /** Devices report a failed action as the same kind with payload { status: "failed" }. */
  ok: boolean;
  eventId: string | null;
}

/** The activity projection outlives raw-event retention, so routines can be mined from weeks of history. */
export async function recordActivity(tx: Queryable, a: ActivityInput): Promise<void> {
  const { date, minute } = localMinute(a.timezone, a.at);
  await tx.query(
    `INSERT INTO activity (household_id, region, person_id, kind, device_id, local_date, local_minute, ok, at, event_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (event_id) DO NOTHING`,
    [a.householdId, a.region, a.personId, a.kind, a.deviceId, date, minute, a.ok, a.at, a.eventId],
  );
}
