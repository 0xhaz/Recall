import { Inject, Injectable } from '@nestjs/common';
import { formatMinute } from '@recall/core';
import { Db } from '../db/db.js';
import { EventLog, lockHousehold } from '../events/event-log.service.js';
import type { Household, Speaker } from '../memory/memory.service.js';
import { localMinute, recordActivity } from './activity.js';
import { checkinMessage, followupText } from './checkins.js';
import { NoticeService } from './notice.service.js';

export type CheckinResult =
  | { logged: true; told: 'household' | 'already_told_today'; message: string; carers_updated: boolean }
  | { logged: false; refused: 'unknown_speaker' | 'not_allowed'; message: string };

/** A person's own "good morning" / "good night": logged, and passed on to the family. */
@Injectable()
export class CheckinService {
  constructor(
    @Inject(Db) private readonly db: Db,
    @Inject(EventLog) private readonly events: EventLog,
    @Inject(NoticeService) private readonly notices: NoticeService,
  ) {}

  async checkin(
    household: Household,
    speaker: Speaker | null,
    part: string,
    deviceId?: string,
    now: Date = new Date(),
  ): Promise<CheckinResult> {
    if (!speaker) {
      return {
        logged: false,
        refused: 'unknown_speaker',
        message: 'A check-in has to come from the person themselves: ask who is speaking.',
      };
    }
    if (speaker.role === 'guest') {
      return { logged: false, refused: 'not_allowed', message: 'Guests have no check-in routine here.' };
    }

    const kind = `checkin.${part}`;
    const local = localMinute(household.timezone, now);
    const time = formatMinute(local.minute);
    const message = checkinMessage(kind, speaker.display_name, time);

    return this.db.transaction(async (tx) => {
      await lockHousehold(tx, household.id);
      await this.events.append(tx, household.id, {
        kind,
        payload: { person_id: speaker.person_id },
        personId: speaker.person_id,
        deviceId: deviceId ?? null,
      });
      await recordActivity(tx, {
        householdId: household.id,
        region: household.region,
        personId: speaker.person_id,
        kind,
        deviceId: deviceId ?? null,
        at: now,
        timezone: household.timezone,
        ok: true,
        eventId: null,
      });

      // Close today's prompt and any alert it led to; tell the carers if they had been alerted.
      const { rows: closed } = await tx.query<{ kind: string }>(
        `UPDATE notice SET acknowledged_at = $4, acknowledged_by = $2
          WHERE household_id = $1 AND person_id = $2 AND acknowledged_at IS NULL
            AND kind IN ('checkin_prompt', 'missed_checkin') AND dedupe_key LIKE '%:' || $3
          RETURNING kind`,
        [household.id, speaker.person_id, local.date, now],
      );
      const carersUpdated = closed.some((n) => n.kind === 'missed_checkin');
      if (carersUpdated) {
        await this.notices.create(tx, {
          householdId: household.id,
          personId: speaker.person_id,
          kind: 'checkin_followup',
          audience: 'carers',
          text: followupText(speaker.display_name, time),
          dedupeKey: `checkin_followup:${speaker.person_id}:${kind}:${local.date}`,
          at: now,
        });
      }

      const told = await this.notices.create(tx, {
        householdId: household.id,
        personId: speaker.person_id,
        kind: 'checkin',
        audience: 'household',
        text: message,
        deviceId: deviceId ?? null,
        dedupeKey: `checkin:${speaker.person_id}:${kind}:${local.date}`,
        at: now,
      });
      return {
        logged: true,
        told: told ? 'household' : 'already_told_today',
        message,
        carers_updated: carersUpdated,
      };
    });
  }
}
