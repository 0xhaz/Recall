import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { addDays, canEditCarePlan, type DayPattern, dayMatches, formatMinute, type Member, screen } from '@recall/core';
import { audit } from '../audit.js';
import { Db } from '../db/db.js';
import { lockHousehold } from '../events/event-log.service.js';
import type { Household, Speaker } from '../memory/memory.service.js';
import { localMinute } from '../routines/activity.js';
import { NoticeService } from '../routines/notice.service.js';
import { reminderConfirmedText, reminderThanks } from './reminders.js';

// A caregiver's schedule for the person they look after, and the record of each dose. Confirming is
// the person's own act: Recall never marks one taken on their behalf, and never guesses from silence.

/** A spoken confirmation is only accepted near the dose it belongs to. */
const CONFIRM_WINDOW_BEFORE_MIN = 60;
const CONFIRM_WINDOW_AFTER_MIN = 240;

export type ReminderKind = 'medication' | 'meal' | 'other';

export interface ReminderInput {
  person: string;
  kind?: ReminderKind;
  label: string;
  dose?: string;
  /** Local times of day, "08:00" or minutes past midnight. */
  times: (string | number)[];
  days?: DayPattern;
  device?: string;
  grace_minutes?: number;
  escalate_after_minutes?: number;
}

export interface Reminder {
  id: string;
  kind: ReminderKind;
  label: string;
  dose: string | null;
  times: string[];
  days: DayPattern;
  device_id: string | null;
  grace_minutes: number;
  escalate_after_minutes: number;
}

export interface DueDose {
  log_id: string | null;
  reminder_id: string;
  label: string;
  dose: string | null;
  kind: ReminderKind;
  due: string;
  status: 'pending' | 'confirmed' | 'missed' | 'skipped' | 'not_due';
  confirmed_at: string | null;
  how: 'voice' | 'console' | null;
  note: string | null;
  by: string | null;
}

export interface DoseRecord {
  label: string;
  kind: ReminderKind;
  due: string;
  /** `no_record` means nothing was logged — not that it was skipped. */
  status: 'confirmed' | 'missed' | 'skipped' | 'unanswered' | 'no_record';
  confirmed_at: string | null;
  how: 'voice' | 'console' | null;
  by: string | null;
}

export interface DoseDay {
  date: string;
  doses: DoseRecord[];
  missed: number;
  unrecorded: number;
}

export type ConfirmResult =
  | { confirmed: true; label: string; at: string; message: string; carers_told: boolean }
  | { confirmed: false; refused: 'unknown_speaker' | 'nothing_due' | 'not_allowed'; message: string };

const minuteOf = (time: string | number): number => {
  if (typeof time === 'number') return Math.max(0, Math.min(1439, Math.round(time)));
  const [hours = 0, minutes = 0] = time.split(':').map(Number);
  return Math.max(0, Math.min(1439, hours * 60 + minutes));
};

interface ReminderRow {
  id: string;
  kind: ReminderKind;
  label: string;
  dose: string | null;
  times: number[];
  days: DayPattern;
  device_id: string | null;
  grace_minutes: number;
  escalate_after_minutes: number;
}

@Injectable()
export class ReminderService {
  constructor(
    @Inject(Db) private readonly db: Db,
    @Inject(NoticeService) private readonly notices: NoticeService,
  ) {}

  /** Only a caregiver holding the care-plan grant, or the household owner, writes the schedule. */
  async set(household: Household, actor: Speaker | null, input: ReminderInput): Promise<{ saved: true; id: string }> {
    if (!actor) throw new ForbiddenException('Ask who is speaking first');
    const subject = await this.caredFor(household.id, input.person);
    await this.mayEdit(household.id, actor, subject);

    const times = [...new Set(input.times.map(minuteOf))].sort((a, b) => a - b);
    if (times.length === 0) throw new NotFoundException('Give at least one time of day');
    const label = screen(input.label).text || input.label;

    const { rows } = await this.db.query<{ id: string }>(
      `INSERT INTO care_reminder (household_id, region, person_id, kind, label, dose, times, days, device_id,
                                  grace_minutes, escalate_after_minutes, author_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING id`,
      [
        household.id,
        household.region,
        subject.person_id,
        input.kind ?? 'medication',
        label,
        input.dose ?? null,
        times,
        input.days ?? 'daily',
        input.device ?? null,
        input.grace_minutes ?? 10,
        input.escalate_after_minutes ?? 30,
        actor.person_id,
      ],
    );
    const id = rows[0]?.id;
    if (!id) throw new NotFoundException('Reminder was not saved');
    await this.db.transaction((tx) =>
      audit(tx, {
        householdId: household.id,
        actorId: actor.person_id,
        action: 'care.reminder_set',
        targetType: 'person',
        targetId: subject.person_id,
        detail: { label, times },
      }),
    );
    return { saved: true, id };
  }

  async remove(household: Household, actor: Speaker | null, reminderId: string): Promise<{ removed: boolean }> {
    if (!actor) throw new ForbiddenException('Ask who is speaking first');
    const { rows } = await this.db.query<{ person_id: string }>(
      'SELECT person_id FROM care_reminder WHERE household_id = $1 AND id = $2 AND removed_at IS NULL',
      [household.id, reminderId],
    );
    const personId = rows[0]?.person_id;
    if (!personId) throw new NotFoundException('No such reminder');
    await this.mayEdit(household.id, actor, await this.member(household.id, personId));
    const { rowCount } = await this.db.query(
      'UPDATE care_reminder SET removed_at = now() WHERE household_id = $1 AND id = $2 AND removed_at IS NULL',
      [household.id, reminderId],
    );
    return { removed: !!rowCount };
  }

  async list(householdId: string, personId: string): Promise<Reminder[]> {
    const { rows } = await this.db.query<ReminderRow>(
      `SELECT id, kind, label, dose, times, days, device_id, grace_minutes, escalate_after_minutes
         FROM care_reminder
        WHERE household_id = $1 AND person_id = $2 AND removed_at IS NULL
        ORDER BY times[1]`,
      [householdId, personId],
    );
    return rows.map((r) => ({ ...r, times: r.times.map(formatMinute) }));
  }

  /** Today's doses: what is due, what was confirmed, what was missed. */
  async today(household: Household, personId: string, now: Date = new Date()): Promise<DueDose[]> {
    const local = localMinute(household.timezone, now);
    const [reminders, logged] = await Promise.all([
      this.db.query<ReminderRow>(
        `SELECT id, kind, label, dose, times, days, device_id, grace_minutes, escalate_after_minutes
           FROM care_reminder WHERE household_id = $1 AND person_id = $2 AND removed_at IS NULL`,
        [household.id, personId],
      ),
      this.db.query<{
        id: string;
        reminder_id: string;
        local_minute: number;
        status: DueDose['status'];
        confirmed_at: Date | null;
        how: 'voice' | 'console' | null;
        note: string | null;
        by: string | null;
      }>(
        `SELECT l.id, l.reminder_id, l.local_minute, l.status, l.confirmed_at, l.how, l.note, p.display_name AS by
           FROM care_reminder_log l LEFT JOIN person p ON p.id = l.confirmed_by
          WHERE l.household_id = $1 AND l.person_id = $2 AND l.local_date = $3`,
        [household.id, personId, local.date],
      ),
    ]);

    const doses: DueDose[] = [];
    for (const reminder of reminders.rows) {
      // A weekdays-only reminder is not due on a Saturday. The watcher has always known that; this
      // did not, so the care page showed a dose nobody was ever going to be asked about.
      if (!dayMatches(reminder.days, local.date)) continue;
      for (const minute of reminder.times) {
        const log = logged.rows.find((l) => l.reminder_id === reminder.id && l.local_minute === minute);
        doses.push({
          log_id: log?.id ?? null,
          reminder_id: reminder.id,
          label: reminder.label,
          dose: reminder.dose,
          kind: reminder.kind,
          due: formatMinute(minute),
          status: log?.status ?? (minute > local.minute ? 'not_due' : 'pending'),
          confirmed_at: log?.confirmed_at?.toISOString() ?? null,
          how: log?.how ?? null,
          note: log?.note ?? null,
          by: log?.by ?? null,
        });
      }
    }
    return doses.sort((a, b) => a.due.localeCompare(b.due));
  }

  /**
   * The days behind today, so a caregiver can see what has been missed rather than only what is due
   * now. Every scheduled dose is listed, including ones with no log row at all: "no record" is its
   * own answer and is not the same as "not taken" (design.md §5). Days a reminder does not run on
   * are skipped, so a weekday tablet is never counted missed on a Sunday.
   */
  async history(household: Household, personId: string, days = 7, now: Date = new Date()): Promise<DoseDay[]> {
    const local = localMinute(household.timezone, now);
    const from = addDays(local.date, -days);
    const [reminders, logged] = await Promise.all([
      this.db.query<ReminderRow>(
        `SELECT id, kind, label, dose, times, days, device_id, grace_minutes, escalate_after_minutes
           FROM care_reminder WHERE household_id = $1 AND person_id = $2 AND removed_at IS NULL`,
        [household.id, personId],
      ),
      this.db.query<{
        reminder_id: string;
        local_date: string;
        local_minute: number;
        /** What the table can actually hold: `not_due` is computed for today, never stored. */
        status: 'pending' | 'confirmed' | 'missed' | 'skipped';
        confirmed_at: Date | null;
        how: 'voice' | 'console' | null;
        by: string | null;
      }>(
        `SELECT l.reminder_id, to_char(l.local_date, 'YYYY-MM-DD') AS local_date, l.local_minute, l.status,
                l.confirmed_at, l.how, p.display_name AS by
           FROM care_reminder_log l LEFT JOIN person p ON p.id = l.confirmed_by
          WHERE l.household_id = $1 AND l.person_id = $2 AND l.local_date >= $3::date AND l.local_date < $4::date`,
        [household.id, personId, from, local.date],
      ),
    ]);

    const out: DoseDay[] = [];
    for (let back = 1; back <= days; back++) {
      const date = addDays(local.date, -back);
      const doses: DoseRecord[] = [];
      for (const reminder of reminders.rows) {
        if (!dayMatches(reminder.days, date)) continue;
        for (const minute of reminder.times) {
          const log = logged.rows.find(
            (l) => l.reminder_id === reminder.id && l.local_date === date && l.local_minute === minute,
          );
          doses.push({
            label: reminder.label,
            kind: reminder.kind,
            due: formatMinute(minute),
            // A log still 'pending' on a day that has ended was asked and never answered.
            status: log ? (log.status === 'pending' ? 'unanswered' : log.status) : 'no_record',
            confirmed_at: log?.confirmed_at?.toISOString() ?? null,
            how: log?.how ?? null,
            by: log?.by ?? null,
          });
        }
      }
      if (doses.length > 0) {
        out.push({
          date,
          doses: doses.sort((a, b) => a.due.localeCompare(b.due)),
          missed: doses.filter((d) => d.status === 'missed' || d.status === 'unanswered').length,
          unrecorded: doses.filter((d) => d.status === 'no_record').length,
        });
      }
    }
    return out;
  }

  /**
   * The person says they have taken it. Only they can say so by voice, and only near the dose it
   * belongs to; whatever they said is kept as screened text, never as audio.
   */
  async confirmSpoken(
    household: Household,
    speaker: Speaker | null,
    said: string | undefined,
    now: Date = new Date(),
  ): Promise<ConfirmResult> {
    if (!speaker) {
      return {
        confirmed: false,
        refused: 'unknown_speaker',
        message: 'Ask who is speaking: a confirmation has to come from the person themselves.',
      };
    }
    const local = localMinute(household.timezone, now);
    const { rows } = await this.db.query<{ id: string; label: string; local_minute: number }>(
      `SELECT l.id, r.label, l.local_minute
         FROM care_reminder_log l JOIN care_reminder r ON r.id = l.reminder_id
        WHERE l.household_id = $1 AND l.person_id = $2 AND l.local_date = $3
          AND l.status IN ('pending', 'missed')
          AND l.local_minute BETWEEN $4 AND $5
        ORDER BY abs(l.local_minute - $6) LIMIT 1`,
      [
        household.id,
        speaker.person_id,
        local.date,
        local.minute - CONFIRM_WINDOW_AFTER_MIN,
        local.minute + CONFIRM_WINDOW_BEFORE_MIN,
        local.minute,
      ],
    );
    const dose = rows[0];
    if (!dose) {
      return {
        confirmed: false,
        refused: 'nothing_due',
        message: "Nothing is waiting to be confirmed right now, so I haven't recorded anything.",
      };
    }
    return this.record(household, dose.id, speaker.person_id, 'voice', said, now);
  }

  /** A caregiver records it in the console, on the person's behalf and marked as such. */
  async confirmManually(
    household: Household,
    actor: Speaker | null,
    logId: string,
    note: string | undefined,
    now: Date = new Date(),
  ): Promise<ConfirmResult> {
    if (!actor) throw new ForbiddenException('Ask who is speaking first');
    const { rows } = await this.db.query<{ person_id: string }>(
      `SELECT person_id FROM care_reminder_log WHERE household_id = $1 AND id = $2`,
      [household.id, logId],
    );
    const personId = rows[0]?.person_id;
    if (!personId) throw new NotFoundException('No such dose');
    if (personId !== actor.person_id)
      await this.mayEdit(household.id, actor, await this.member(household.id, personId));
    return this.record(household, logId, actor.person_id, 'console', note, now);
  }

  private async record(
    household: Household,
    logId: string,
    byPersonId: string,
    how: 'voice' | 'console',
    said: string | undefined,
    now: Date,
  ): Promise<ConfirmResult> {
    const note = said?.trim() ? screen(said).text || null : null;
    return this.db.transaction(async (tx) => {
      await lockHousehold(tx, household.id);
      const { rows } = await tx.query<{
        person_id: string;
        label: string;
        local_date: string;
        name: string;
        by: string | null;
      }>(
        `UPDATE care_reminder_log l
            SET status = 'confirmed', confirmed_at = $3, confirmed_by = $4, how = $5, note = $6
           FROM care_reminder r, person p
          WHERE l.household_id = $1 AND l.id = $2 AND r.id = l.reminder_id AND p.id = l.person_id
            AND l.status IN ('pending', 'missed')
        RETURNING l.person_id, r.label, l.local_date::text AS local_date, p.display_name AS name,
                  (SELECT display_name FROM person WHERE id = $4) AS by`,
        [household.id, logId, now, byPersonId, how, note],
      );
      const dose = rows[0];
      if (!dose) {
        return {
          confirmed: false as const,
          refused: 'nothing_due' as const,
          message: 'That dose has already been dealt with.',
        };
      }

      // Close the prompt and any alert it caused, so nobody is chased for something already done.
      const { rows: closed } = await tx.query<{ kind: string }>(
        `UPDATE notice SET acknowledged_at = $3, acknowledged_by = $4
          WHERE household_id = $1 AND acknowledged_at IS NULL
            AND kind IN ('reminder_prompt', 'reminder_missed') AND dedupe_key LIKE '%:' || $2
          RETURNING kind`,
        [household.id, logId, now, byPersonId],
      );
      const time = formatMinute(localMinute(household.timezone, now).minute);
      const carersTold = await this.notices.create(tx, {
        householdId: household.id,
        personId: dose.person_id,
        kind: 'reminder_confirmed',
        audience: 'carers',
        text: reminderConfirmedText(dose.name, dose.label, time, how, dose.by),
        dedupeKey: `reminder_confirmed:${logId}`,
        at: now,
      });
      return {
        confirmed: true as const,
        label: dose.label,
        at: now.toISOString(),
        message: reminderThanks(dose.label),
        carers_told: !!carersTold || closed.some((n) => n.kind === 'reminder_missed'),
      };
    });
  }

  private async caredFor(householdId: string, who: string): Promise<Member & { display_name: string }> {
    const { rows } = await this.db.query<Member & { display_name: string }>(
      `SELECT m.person_id, m.role, m.grants::text[] AS grants, m.capacity_flag, p.display_name
         FROM membership m JOIN person p ON p.id = m.person_id
        WHERE m.household_id = $1 AND m.revoked_at IS NULL
          AND (p.id::text = $2 OR lower(p.display_name) = lower($2))
        LIMIT 2`,
      [householdId, who.trim()],
    );
    const subject = rows.length === 1 ? rows[0] : undefined;
    if (!subject) throw new NotFoundException(`No one called ${who} here`);
    if (subject.role !== 'cared_for') {
      throw new ForbiddenException(`${subject.display_name} isn't being cared for here`);
    }
    return subject;
  }

  private async member(householdId: string, personId: string): Promise<Member & { display_name: string }> {
    const { rows } = await this.db.query<Member & { display_name: string }>(
      `SELECT m.person_id, m.role, m.grants::text[] AS grants, m.capacity_flag, p.display_name
         FROM membership m JOIN person p ON p.id = m.person_id
        WHERE m.household_id = $1 AND m.person_id = $2 AND m.revoked_at IS NULL`,
      [householdId, personId],
    );
    const member = rows[0];
    if (!member) throw new NotFoundException('Not a member of this household');
    return member;
  }

  private async mayEdit(householdId: string, actor: Speaker, subject: Member): Promise<void> {
    const me = await this.member(householdId, actor.person_id);
    if (actor.role === 'owner' || canEditCarePlan(me, subject)) return;
    throw new ForbiddenException('Only a caregiver with the care-plan grant, or the household owner, can set this');
  }
}
