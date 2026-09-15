import { Inject, Injectable } from '@nestjs/common';
import { type DayPattern, dayMatches, formatMinute, US_HOLIDAYS_2026 } from '@recall/core';
import { Db } from '../db/db.js';
import { lockHousehold } from '../events/event-log.service.js';
import { localMinute } from './activity.js';
import { missedText, promptText } from './checkins.js';
import { NoticeService } from './notice.service.js';

/** How late before the person is gently asked, at least; and how long they get to answer before carers hear. */
const MIN_GRACE_MIN = 30;
const ESCALATE_AFTER_MIN = 30;
/** Only established check-in habits are watched. */
const MIN_CONFIDENCE = 0.4;

interface WatchedRoutine {
  id: string;
  household_id: string;
  person_id: string;
  kind: string;
  days: DayPattern;
  center_minute: number;
  spread_minutes: number;
  timezone: string;
  display_name: string;
}

export interface AbsenceReport {
  prompted: number;
  escalated: number;
}

/**
 * The absence of a usual check-in is the signal (architecture.md §2 step 7): ask the person first,
 * and only if they still haven't answered, tell the carers. Never answers on the person's behalf.
 */
@Injectable()
export class AbsenceWatcher {
  constructor(
    @Inject(Db) private readonly db: Db,
    @Inject(NoticeService) private readonly notices: NoticeService,
  ) {}

  async check(now: Date = new Date()): Promise<AbsenceReport> {
    const { rows } = await this.db.query<WatchedRoutine>(
      `SELECT r.id, r.household_id, r.person_id, r.kind, r.days, r.center_minute, r.spread_minutes,
              h.timezone, p.display_name
         FROM routine r
         JOIN household h ON h.id = r.household_id
         JOIN person p ON p.id = r.person_id
         JOIN membership m ON m.household_id = r.household_id AND m.person_id = r.person_id AND m.revoked_at IS NULL
        WHERE r.kind LIKE 'checkin.%' AND r.status <> 'retired' AND r.confidence >= $1`,
      [MIN_CONFIDENCE],
    );
    const report: AbsenceReport = { prompted: 0, escalated: 0 };
    for (const r of rows) {
      const local = localMinute(r.timezone, now);
      if (US_HOLIDAYS_2026.has(local.date) || !dayMatches(r.days, local.date)) continue;
      const due = r.center_minute + Math.max(MIN_GRACE_MIN, 2 * r.spread_minutes);
      if (local.minute < due) continue;

      const done = await this.db.query(
        'SELECT 1 FROM activity WHERE household_id = $1 AND person_id = $2 AND kind = $3 AND local_date = $4',
        [r.household_id, r.person_id, r.kind, local.date],
      );
      if (done.rowCount) continue;

      const promptKey = `checkin_prompt:${r.id}:${local.date}`;
      const { rows: prompts } = await this.db.query<{ created_at: Date }>(
        'SELECT created_at FROM notice WHERE household_id = $1 AND dedupe_key = $2',
        [r.household_id, promptKey],
      );
      const prompt = prompts[0];

      await this.db.transaction(async (tx) => {
        await lockHousehold(tx, r.household_id);
        if (!prompt) {
          const { rows: devices } = await tx.query<{ device_id: string }>(
            `SELECT device_id FROM activity WHERE household_id = $1 AND person_id = $2 AND kind = $3 AND device_id IS NOT NULL
             ORDER BY at DESC LIMIT 1`,
            [r.household_id, r.person_id, r.kind],
          );
          const created = await this.notices.create(tx, {
            householdId: r.household_id,
            personId: r.person_id,
            kind: 'checkin_prompt',
            audience: 'person',
            text: promptText(r.kind, r.display_name),
            deviceId: devices[0]?.device_id ?? null,
            dedupeKey: promptKey,
            at: now,
          });
          if (created) report.prompted++;
        } else if (now.getTime() - prompt.created_at.getTime() >= ESCALATE_AFTER_MIN * 60_000) {
          const asked = formatMinute(localMinute(r.timezone, prompt.created_at).minute);
          const created = await this.notices.create(tx, {
            householdId: r.household_id,
            personId: r.person_id,
            kind: 'missed_checkin',
            audience: 'carers',
            text: missedText(r.kind, r.display_name, formatMinute(r.center_minute), asked),
            dedupeKey: `missed_checkin:${r.id}:${local.date}`,
            at: now,
          });
          if (created) report.escalated++;
        }
      });
    }
    return report;
  }
}
