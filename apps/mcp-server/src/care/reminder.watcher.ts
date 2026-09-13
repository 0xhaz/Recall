import { Inject, Injectable } from '@nestjs/common';
import { type DayPattern, dayMatches, formatMinute, temporalStamp } from '@recall/core';
import { Db, type Queryable } from '../db/db.js';
import { lockHousehold } from '../events/event-log.service.js';
import { localMinute } from '../routines/activity.js';
import { NoticeService } from '../routines/notice.service.js';
import { reminderMissedText, reminderPrompt } from './reminders.js';

// Asks the person on their own device when a dose is due, and tells the carers only if it goes
// unanswered (design.md §5). Silence is never read as "taken", and never as "not taken" either:
// the record says unconfirmed, which is exactly what is known.

interface DueReminder {
  id: string;
  household_id: string;
  region: string;
  person_id: string;
  display_name: string;
  timezone: string;
  kind: string;
  label: string;
  dose: string | null;
  times: number[];
  days: DayPattern;
  device_id: string | null;
  grace_minutes: number;
  escalate_after_minutes: number;
}

export interface ReminderReport {
  prompted: number;
  escalated: number;
}

@Injectable()
export class ReminderWatcher {
  constructor(
    @Inject(Db) private readonly db: Db,
    @Inject(NoticeService) private readonly notices: NoticeService,
  ) {}

  async check(now: Date = new Date()): Promise<ReminderReport> {
    const { rows } = await this.db.query<DueReminder>(
      `SELECT r.id, r.household_id, r.region, r.person_id, p.display_name, h.timezone, r.kind, r.label, r.dose,
              r.times, r.days, r.device_id, r.grace_minutes, r.escalate_after_minutes
         FROM care_reminder r
         JOIN household h ON h.id = r.household_id
         JOIN person p ON p.id = r.person_id
         JOIN membership m ON m.household_id = r.household_id AND m.person_id = r.person_id
          AND m.revoked_at IS NULL AND m.role = 'cared_for'
        WHERE r.removed_at IS NULL`,
    );

    const report: ReminderReport = { prompted: 0, escalated: 0 };
    for (const reminder of rows) {
      const local = localMinute(reminder.timezone, now);
      if (!dayMatches(reminder.days, local.date)) continue;
      const offset = temporalStamp(reminder.timezone, now).utc_offset;

      for (const minute of reminder.times) {
        // Due once the grace period has passed, so an early confirmation isn't chased.
        if (local.minute < minute + reminder.grace_minutes) continue;
        const dueAt = new Date(`${local.date}T${formatMinute(minute)}:00${offset}`);
        await this.db.transaction(async (tx) => {
          await lockHousehold(tx, reminder.household_id);
          const { rows: logged } = await tx.query<{
            id: string;
            status: string;
            prompted_at: Date | null;
            escalated_at: Date | null;
          }>(
            `INSERT INTO care_reminder_log (household_id, region, reminder_id, person_id, local_date, local_minute,
                                            due_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             ON CONFLICT (reminder_id, due_at) DO UPDATE SET reminder_id = EXCLUDED.reminder_id
             RETURNING id, status, prompted_at, escalated_at`,
            [reminder.household_id, reminder.region, reminder.id, reminder.person_id, local.date, minute, dueAt],
          );
          const dose = logged[0];
          if (!dose || dose.status === 'confirmed' || dose.status === 'skipped') return;

          if (!dose.prompted_at) {
            const device = reminder.device_id ?? (await this.usualDevice(tx, reminder));
            const created = await this.notices.create(tx, {
              householdId: reminder.household_id,
              personId: reminder.person_id,
              kind: 'reminder_prompt',
              audience: 'person',
              text: reminderPrompt(reminder.display_name, reminder.label, reminder.dose, reminder.kind),
              deviceId: device,
              dedupeKey: `reminder_prompt:${dose.id}`,
              at: now,
            });
            await tx.query('UPDATE care_reminder_log SET prompted_at = $2 WHERE id = $1', [dose.id, now]);
            if (created) report.prompted++;
            return;
          }

          const waited = now.getTime() - dose.prompted_at.getTime();
          if (dose.escalated_at || waited < reminder.escalate_after_minutes * 60_000) return;

          const asked = formatMinute(localMinute(reminder.timezone, dose.prompted_at).minute);
          const created = await this.notices.create(tx, {
            householdId: reminder.household_id,
            personId: reminder.person_id,
            kind: 'reminder_missed',
            audience: 'carers',
            text: reminderMissedText(reminder.display_name, reminder.label, formatMinute(minute), asked),
            dedupeKey: `reminder_missed:${dose.id}`,
            at: now,
          });
          await tx.query(`UPDATE care_reminder_log SET status = 'missed', escalated_at = $2 WHERE id = $1`, [
            dose.id,
            now,
          ]);
          if (created) report.escalated++;
        });
      }
    }
    return report;
  }

  /** Their own device if one is theirs, otherwise wherever they last spoke. */
  private async usualDevice(tx: Queryable, reminder: DueReminder): Promise<string | null> {
    const { rows } = await tx.query<{ device_id: string | null }>(
      `SELECT COALESCE(
                (SELECT device_id FROM device WHERE household_id = $1 AND primary_person_id = $2 LIMIT 1),
                (SELECT device_id FROM activity
                  WHERE household_id = $1 AND person_id = $2 AND device_id IS NOT NULL
                  ORDER BY at DESC LIMIT 1)
              ) AS device_id`,
      [reminder.household_id, reminder.person_id],
    );
    return rows[0]?.device_id ?? null;
  }
}
