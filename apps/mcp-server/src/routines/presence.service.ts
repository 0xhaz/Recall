import { Inject, Injectable } from '@nestjs/common';
import { formatMinute, isNight, isUsualAt, nightOf, presenceAlertText } from '@recall/core';
import { Db } from '../db/db.js';
import { lockHousehold } from '../events/event-log.service.js';
import { localMinute } from './activity.js';
import { NoticeService } from './notice.service.js';

/** Reports this recent are looked at; ingest queues a check for every door, motion or Ring report. */
const LOOKBACK_MIN = 15;
const HISTORY_DAYS = 14;

/**
 * Presence escalation (design.md §5): in a household with someone being cared for, a door or
 * movement at night that isn't usual for that time tells the carers, once per night and kind.
 * Reports attributed to another known member are theirs, not a reason for alarm.
 */
@Injectable()
export class PresenceWatcher {
  constructor(
    @Inject(Db) private readonly db: Db,
    @Inject(NoticeService) private readonly notices: NoticeService,
  ) {}

  async check(householdId: string, now: Date = new Date()): Promise<number> {
    const { rows: cared } = await this.db.query<{ person_id: string; display_name: string; timezone: string }>(
      `SELECT m.person_id, p.display_name, h.timezone
         FROM membership m JOIN person p ON p.id = m.person_id JOIN household h ON h.id = m.household_id
        WHERE m.household_id = $1 AND m.role = 'cared_for' AND m.revoked_at IS NULL`,
      [householdId],
    );
    const timezone = cared[0]?.timezone;
    if (!timezone) return 0;

    const { rows: events } = await this.db.query<{
      kind: string;
      person_id: string | null;
      location: string | null;
      at: Date;
      role: string | null;
    }>(
      `SELECT e.kind, e.person_id, e.location, e.occurred_at AS at, m.role
         FROM event e
         LEFT JOIN membership m ON m.household_id = e.household_id AND m.person_id = e.person_id
        WHERE e.household_id = $1 AND e.kind ~ '^(door|motion|ring)\\.'
          AND e.occurred_at > $2::timestamptz - make_interval(mins => ${LOOKBACK_MIN}) AND e.occurred_at <= $2
        ORDER BY e.occurred_at`,
      [householdId, now],
    );

    let alerted = 0;
    for (const e of events) {
      if (e.person_id && e.role !== 'cared_for') continue;
      const local = localMinute(timezone, e.at);
      if (!isNight(local.minute)) continue;
      const { rows: history } = await this.db.query<{ local_date: string; local_minute: number }>(
        `SELECT local_date::text AS local_date, local_minute FROM activity
          WHERE household_id = $1 AND kind = $2 AND local_date >= $3::date - ${HISTORY_DAYS} AND local_date < $3::date`,
        [householdId, e.kind, local.date],
      );
      if (isUsualAt(local.minute, history)) continue;

      const who = e.person_id ? cared.filter((c) => c.person_id === e.person_id) : cared;
      const created = await this.db.transaction(async (tx) => {
        await lockHousehold(tx, householdId);
        return this.notices.create(tx, {
          householdId,
          personId: who.length === 1 ? (who[0]?.person_id ?? null) : null,
          kind: 'presence_alert',
          audience: 'carers',
          text: presenceAlertText(
            e.kind,
            e.location,
            formatMinute(local.minute),
            who.map((c) => c.display_name),
          ),
          dedupeKey: `presence:${e.kind}:${nightOf(local.date, local.minute)}`,
          at: now,
        });
      });
      if (created) alerted++;
    }
    return alerted;
  }
}
