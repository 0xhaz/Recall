import { Inject, Injectable } from '@nestjs/common';
import {
  addDays,
  CONTEXT_CONFIG,
  type ContextName,
  type ContextState,
  type DayPattern,
  dayMatches,
  deriveSignals,
  IDLE_CONTEXT,
  PERSONAL_CONTEXTS,
  type Scored,
  scoreHousehold,
  scoreWorkout,
  stepContext,
  US_FESTIVALS_2026,
} from '@recall/core';
import { Db, type Queryable } from '../db/db.js';
import { EventLog, lockHousehold } from '../events/event-log.service.js';
import type { Household, Speaker } from '../memory/memory.service.js';
import { localMinute } from '../routines/activity.js';

const DEFAULT_RESTING_HR = 65;
const DEFAULT_WORKOUT_RATIO = 1.2;
/** A resting rate is only trusted once there are enough samples across more than one day. */
const MIN_RESTING_SAMPLES = 200;
const ROUTINE_WINDOW_MIN = 30;

interface StateRow {
  person_key: string;
  person_id: string | null;
  context: ContextName;
  score: number;
  active: boolean;
  since: Date | null;
  above_since: Date | null;
  below_since: Date | null;
  manual_until: Date | null;
  reasons: string[];
  display_name: string | null;
}

export interface ContextView {
  context: ContextName;
  for: string;
  score: number;
  active: boolean;
  since: string | null;
  manual: boolean;
  reasons: string[];
}

export interface ContextReading {
  contexts: ContextView[];
  quiet_hours: { active: boolean; because: string[] };
}

const iso = (d: Date | null) => d?.toISOString() ?? null;
const toState = (r: StateRow | undefined): ContextState =>
  r
    ? {
        active: r.active,
        since: iso(r.since),
        above_since: iso(r.above_since),
        below_since: iso(r.below_since),
        manual_until: iso(r.manual_until),
      }
    : IDLE_CONTEXT;

/**
 * Context scores as a server-side projection (architecture.md §3): recomputed by the worker from
 * the last hour of reports, persisted so every device reads the same value, and announced with a
 * context.changed event whenever one switches on or off.
 */
@Injectable()
export class ContextService {
  constructor(
    @Inject(Db) private readonly db: Db,
    @Inject(EventLog) private readonly events: EventLog,
  ) {}

  async evaluate(householdId: string, now: Date = new Date()): Promise<ContextReading> {
    const household = await this.household(householdId);
    const local = localMinute(household.timezone, now);

    const { rows: recent } = await this.db.query<{
      kind: string;
      person_id: string | null;
      device_id: string | null;
      payload: Record<string, unknown>;
      at: Date;
    }>(
      `SELECT kind, person_id, device_id, payload, occurred_at AS at FROM event
        WHERE household_id = $1 AND occurred_at > $2::timestamptz - interval '60 minutes' AND occurred_at <= $2
          AND kind ~ '^(hr|phone|lights|sound|door|ring|presence)\\.|^session\\.turn$'`,
      [householdId, now],
    );
    const signals = deriveSignals(
      recent.map((r) => ({ ...r, at: r.at.toISOString() })),
      now,
    );
    const { rows: sleep } = await this.db.query<{ kind: string }>(
      `SELECT DISTINCT ON (person_id) kind FROM event
        WHERE household_id = $1 AND kind IN ('sleep.start', 'sleep.end') AND person_id IS NOT NULL
          AND occurred_at > $2::timestamptz - interval '16 hours' AND occurred_at <= $2
        ORDER BY person_id, occurred_at DESC`,
      [householdId, now],
    );
    const householdScores = scoreHousehold({
      ...signals.household,
      local,
      sleeping: sleep.some((s) => s.kind === 'sleep.start'),
      festival: {
        today: US_FESTIVALS_2026.get(local.date) ?? null,
        near: US_FESTIVALS_2026.get(addDays(local.date, 1)) ?? US_FESTIVALS_2026.get(addDays(local.date, -1)) ?? null,
      },
    });

    const { rows: states } = await this.db.query<StateRow>(
      `SELECT person_key, person_id, context, score, active, since, above_since, below_since, manual_until, reasons,
              NULL AS display_name
         FROM context_state WHERE household_id = $1`,
      [householdId],
    );
    const people = new Set([
      ...signals.people.keys(),
      ...states.filter((s) => s.person_key !== '').map((s) => s.person_key),
    ]);
    const baselines = await this.baselines(householdId, [...people]);
    const { rows: routines } = await this.db.query<{ person_id: string; center_minute: number; days: DayPattern }>(
      `SELECT person_id, center_minute, days FROM routine
        WHERE household_id = $1 AND kind LIKE 'workout.%' AND status <> 'retired' AND person_id IS NOT NULL`,
      [householdId],
    );

    const scored: { personKey: string; personId: string | null; context: ContextName; result: Scored }[] =
      Object.entries(householdScores).map(([context, result]) => ({
        personKey: '',
        personId: null,
        context: context as ContextName,
        result,
      }));
    for (const personId of people) {
      const s = signals.people.get(personId) ?? { hr_bpm: null, motion_spm: null };
      const baseline = baselines.get(personId) ?? { resting: DEFAULT_RESTING_HR, threshold: DEFAULT_WORKOUT_RATIO };
      scored.push({
        personKey: personId,
        personId,
        context: 'workout',
        result: scoreWorkout({
          hr_bpm: s.hr_bpm,
          motion_spm: s.motion_spm,
          resting_hr: baseline.resting,
          threshold: baseline.threshold,
          near_routine: routines.some(
            (r) =>
              r.person_id === personId &&
              dayMatches(r.days, local.date) &&
              Math.abs(r.center_minute - local.minute) <= ROUTINE_WINDOW_MIN,
          ),
        }),
      });
    }

    await this.db.transaction(async (tx) => {
      await lockHousehold(tx, householdId);
      for (const s of scored) {
        const prev = toState(states.find((r) => r.person_key === s.personKey && r.context === s.context));
        const next = stepContext(prev, s.result.score, now, CONTEXT_CONFIG[s.context]);
        await tx.query(
          `INSERT INTO context_state (household_id, region, person_key, person_id, context, score, active, since,
                                      above_since, below_since, manual_until, reasons, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, now())
           ON CONFLICT (household_id, person_key, context) DO UPDATE SET
             score = EXCLUDED.score, active = EXCLUDED.active, since = EXCLUDED.since,
             above_since = EXCLUDED.above_since, below_since = EXCLUDED.below_since,
             manual_until = EXCLUDED.manual_until, reasons = EXCLUDED.reasons, updated_at = now()`,
          [
            householdId,
            household.region,
            s.personKey,
            s.personId,
            s.context,
            s.result.score,
            next.active,
            next.since,
            next.above_since,
            next.below_since,
            next.manual_until,
            s.result.reasons,
          ],
        );
        if (next.active !== prev.active) {
          await this.events.append(tx, householdId, {
            kind: 'context.changed',
            payload: {
              context: s.context,
              person_id: s.personId,
              active: next.active,
              score: s.result.score,
              reasons: s.result.reasons,
            },
            personId: s.personId,
          });
        }
      }
    });
    return this.read(householdId, null, now);
  }

  /** The projection as it stands: what get_context and session_brief return (no computation). */
  async read(householdId: string, personId: string | null, now: Date = new Date()): Promise<ContextReading> {
    const { rows } = await this.db.query<StateRow>(
      `SELECT cs.person_key, cs.person_id, cs.context, cs.score, cs.active, cs.since, cs.above_since, cs.below_since,
              cs.manual_until, cs.reasons, p.display_name
         FROM context_state cs LEFT JOIN person p ON p.id = cs.person_id
        WHERE cs.household_id = $1 AND ($2::text IS NULL OR cs.person_key = '' OR cs.person_key = $2)
        ORDER BY cs.active DESC, cs.score DESC`,
      [householdId, personId],
    );
    const contexts = rows.map((r) => ({
      context: r.context,
      for: r.person_key === '' ? 'household' : (r.display_name ?? 'someone'),
      score: r.score,
      active: r.active,
      since: iso(r.since),
      manual: !!r.manual_until && r.manual_until.getTime() > now.getTime(),
      reasons: r.reasons,
    }));
    const windDown = contexts.find((c) => c.context === 'wind_down' && c.for === 'household');
    return {
      contexts,
      quiet_hours: { active: !!windDown?.active, because: windDown?.active ? windDown.reasons : [] },
    };
  }

  /**
   * "Workout mode" / "stop workout mode": wins over the signals for a while, and teaches — the heart
   * rate at the moment someone says they're working out calibrates their automatic trigger (§3).
   */
  async setManual(
    household: Household,
    speaker: Speaker,
    context: ContextName,
    on: boolean,
    minutes?: number,
    now: Date = new Date(),
  ): Promise<ContextView> {
    const personal = PERSONAL_CONTEXTS.has(context);
    const personKey = personal ? speaker.person_id : '';
    const until = new Date(now.getTime() + (minutes ?? CONTEXT_CONFIG[context].manual_minutes) * 60_000);
    const reasons = [`turned ${on ? 'on' : 'off'} by ${speaker.display_name}`];

    await this.db.transaction(async (tx) => {
      await lockHousehold(tx, household.id);
      const { rows } = await tx.query<{ active: boolean }>(
        'SELECT active FROM context_state WHERE household_id = $1 AND person_key = $2 AND context = $3',
        [household.id, personKey, context],
      );
      await tx.query(
        `INSERT INTO context_state (household_id, region, person_key, person_id, context, score, active, since,
                                    manual_until, reasons, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now())
         ON CONFLICT (household_id, person_key, context) DO UPDATE SET
           score = EXCLUDED.score, active = EXCLUDED.active, since = EXCLUDED.since, above_since = NULL,
           below_since = NULL, manual_until = EXCLUDED.manual_until, reasons = EXCLUDED.reasons, updated_at = now()`,
        [
          household.id,
          household.region,
          personKey,
          personal ? speaker.person_id : null,
          context,
          on ? 1 : 0,
          on,
          on ? now : null,
          until,
          reasons,
        ],
      );
      if ((rows[0]?.active ?? false) !== on) {
        await this.events.append(tx, household.id, {
          kind: 'context.changed',
          payload: { context, person_id: personal ? speaker.person_id : null, active: on, score: on ? 1 : 0, reasons },
          personId: personal ? speaker.person_id : null,
        });
      }
      if (context === 'workout' && on) await this.learnWorkoutThreshold(tx, household, speaker.person_id, now);
    });

    return {
      context,
      for: personal ? speaker.display_name : 'household',
      score: on ? 1 : 0,
      active: on,
      since: on ? now.toISOString() : null,
      manual: true,
      reasons,
    };
  }

  /** Households whose contexts are switching, or on, need re-evaluating even without new reports. */
  async pending(): Promise<string[]> {
    const { rows } = await this.db.query<{ household_id: string }>(
      `SELECT DISTINCT household_id FROM context_state
        WHERE active OR above_since IS NOT NULL OR below_since IS NOT NULL`,
    );
    return rows.map((r) => r.household_id);
  }

  private async household(householdId: string): Promise<Household> {
    const { rows } = await this.db.query<Household>('SELECT id, name, region, timezone FROM household WHERE id = $1', [
      householdId,
    ]);
    const household = rows[0];
    if (!household) throw new Error(`Household ${householdId} not found`);
    return household;
  }

  /** Resting heart rate from the person's own week of samples, once there are enough; learned trigger if any. */
  private async baselines(
    householdId: string,
    personIds: string[],
  ): Promise<Map<string, { resting: number; threshold: number }>> {
    if (personIds.length === 0) return new Map();
    const { rows } = await this.db.query<{ person_id: string; resting: number | null; ratio: number | null }>(
      `SELECT p.id AS person_id,
              (SELECT percentile_cont(0.05) WITHIN GROUP (ORDER BY (e.payload->>'bpm')::real)
                 FROM event e
                WHERE e.household_id = $1 AND e.person_id = p.id AND e.kind = 'hr.sample'
                  AND e.payload->>'bpm' ~ '^[0-9]+(\\.[0-9]+)?$'
               HAVING count(*) >= ${MIN_RESTING_SAMPLES} AND count(DISTINCT e.occurred_at::date) >= 2) AS resting,
              b.workout_ratio AS ratio
         FROM person p
         LEFT JOIN context_baseline b ON b.household_id = $1 AND b.person_id = p.id
        WHERE p.id = ANY($2::uuid[])`,
      [householdId, personIds],
    );
    return new Map(
      rows.map((r) => [
        r.person_id,
        { resting: r.resting ?? DEFAULT_RESTING_HR, threshold: r.ratio ?? DEFAULT_WORKOUT_RATIO },
      ]),
    );
  }

  private async learnWorkoutThreshold(tx: Queryable, household: Household, personId: string, now: Date): Promise<void> {
    const { rows } = await tx.query<{ bpm: number | null }>(
      `SELECT avg((payload->>'bpm')::real) AS bpm FROM event
        WHERE household_id = $1 AND person_id = $2 AND kind = 'hr.sample'
          AND payload->>'bpm' ~ '^[0-9]+(\\.[0-9]+)?$'
          AND occurred_at > $3::timestamptz - interval '3 minutes' AND occurred_at <= $3`,
      [household.id, personId, now],
    );
    const bpm = rows[0]?.bpm;
    if (!bpm) return;
    const [baseline] = (await this.baselines(household.id, [personId])).values();
    // Trigger a little below what they had when they said it, so next time it's noticed on its own.
    const observed = Math.min(1.6, Math.max(1.1, bpm / (baseline?.resting ?? DEFAULT_RESTING_HR) - 0.05));
    await tx.query(
      `INSERT INTO context_baseline (household_id, region, person_id, workout_ratio, manual_samples, updated_at)
       VALUES ($1, $2, $3, $4, 1, now())
       ON CONFLICT (household_id, person_id) DO UPDATE SET
         workout_ratio = (COALESCE(context_baseline.workout_ratio, ${DEFAULT_WORKOUT_RATIO}) * context_baseline.manual_samples + $4)
                         / (context_baseline.manual_samples + 1),
         manual_samples = context_baseline.manual_samples + 1, updated_at = now()`,
      [household.id, household.region, personId, observed],
    );
  }
}
