import { Inject, Injectable } from '@nestjs/common';
import type { Queryable } from '../db/db.js';
import { EventLog } from '../events/event-log.service.js';

export type NoticeAudience = 'person' | 'household' | 'carers';

export interface NewNotice {
  householdId: string;
  personId: string | null;
  kind: string;
  /** person: said to them on their device · household: everyone at home · carers: caregivers and household adults. */
  audience: NoticeAudience;
  text: string;
  deviceId?: string | null;
  /** Each notice is delivered once: the same key never creates a second one. */
  dedupeKey: string;
  at: Date;
}

/** Messages, prompts and alerts, delivered to devices as notice.created events. */
@Injectable()
export class NoticeService {
  constructor(@Inject(EventLog) private readonly events: EventLog) {}

  /** Caller holds lockHousehold. Returns null when a notice with this key already exists. */
  async create(tx: Queryable, n: NewNotice): Promise<string | null> {
    const { rows } = await tx.query<{ id: string }>(
      `INSERT INTO notice (household_id, region, person_id, kind, audience, text, device_id, dedupe_key, created_at)
       SELECT h.id, h.region, $2, $3, $4, $5, $6, $7, $8 FROM household h WHERE h.id = $1
       ON CONFLICT (household_id, dedupe_key) DO NOTHING
       RETURNING id`,
      [n.householdId, n.personId, n.kind, n.audience, n.text, n.deviceId ?? null, n.dedupeKey, n.at],
    );
    const id = rows[0]?.id;
    if (!id) return null;
    await this.events.append(tx, n.householdId, {
      kind: 'notice.created',
      payload: { notice_id: id, kind: n.kind, audience: n.audience, text: n.text, person_id: n.personId },
      personId: n.personId,
      deviceId: n.deviceId ?? null,
    });
    return id;
  }
}
