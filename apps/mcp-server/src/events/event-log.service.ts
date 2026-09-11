import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  asDeviceState,
  compareHlc,
  DEVICE_STATE_KIND,
  type HybridClock,
  hlcWallTime,
  type ProjectionState,
  parseHlc,
  reduceDeviceState,
  type SyncEvent,
} from '@recall/core';
import type { HouseholdContext } from '../auth/household-auth.js';
import { Db, type Queryable } from '../db/db.js';

export const CLOCK = Symbol('CLOCK');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KIND = /^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$/;
/** Only the server writes these: memory changes go through the tools, never raw device events. */
const RESERVED_KIND = /^(fact|rule|utterance|action|memory)\./;
/** Raw health signals: kept 7 days, never synced to other devices; only derived context survives. */
const SENSITIVE_KIND = /^(health|hr|biometric)\./;
const MAX_FUTURE_DRIFT_MS = 5 * 60_000;
const MAX_TURN_TEXT = 4000;
export const SYNC_PAGE = 200;

export interface DeviceInput {
  id: string;
  name?: string;
  location?: string;
}

export interface IncomingEvent {
  event_id: string;
  hlc: string;
  kind: string;
  person?: string;
  person_confidence?: number;
  location?: string;
  payload?: Record<string, unknown>;
}

export interface IngestResult {
  accepted: number;
  duplicates: number;
  rejected: { event_id: string; reason: string }[];
}

export type SyncResult =
  | { mode: 'replay'; events: SyncEvent[]; next_cursor: number; has_more: boolean }
  | { mode: 'snapshot'; snapshot: ProjectionState; next_cursor: number; has_more: true };

export interface ServerEvent {
  kind: string;
  payload: Record<string, unknown>;
  personId?: string | null;
  deviceId?: string | null;
  tombstone?: boolean;
}

interface EventRow {
  seq: string;
  event_id: string;
  hlc: string;
  kind: string;
  device_id: string | null;
  person_id: string | null;
  payload: Record<string, unknown>;
}

/**
 * Serialise event writes per household, so seq order equals commit order and a device cursor can
 * never step past an event that commits later. Take it first in every event-writing transaction.
 */
export async function lockHousehold(tx: Queryable, householdId: string): Promise<void> {
  await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [householdId]);
}

const text = (value: unknown): string | null => (typeof value === 'string' && value.trim() ? value.trim() : null);

/** The append-only log that is the source of truth for every device (architecture.md §4). */
@Injectable()
export class EventLog {
  constructor(
    @Inject(Db) private readonly db: Db,
    @Inject(CLOCK) private readonly clock: HybridClock,
  ) {}

  /** Append a server-originated event inside a transaction that holds lockHousehold. Returns its HLC. */
  async append(tx: Queryable, householdId: string, event: ServerEvent): Promise<string> {
    const hlc = this.clock.tick();
    await tx.query(
      `INSERT INTO event (event_id, household_id, region, hlc, device_id, person_id, kind, payload, tombstone)
       SELECT $1, h.id, h.region, $3, $4, $5, $6, $7, $8 FROM household h WHERE h.id = $2`,
      [
        randomUUID(),
        householdId,
        hlc,
        event.deviceId ?? null,
        event.personId ?? null,
        event.kind,
        JSON.stringify(event.payload),
        event.tombstone ?? false,
      ],
    );
    return hlc;
  }

  /** fact.created carrying the canonical fact_view, with fact.hlc stamped so projections agree. */
  async factCreated(tx: Queryable, factId: string): Promise<string> {
    const hlc = this.clock.tick();
    await tx.query('UPDATE fact SET hlc = $2 WHERE id = $1', [factId, hlc]);
    await tx.query(
      `INSERT INTO event (event_id, household_id, region, hlc, kind, payload)
       SELECT $1, v.household_id, v.region, v.hlc, 'fact.created', jsonb_build_object('fact', v.view)
         FROM fact_view v WHERE v.id = $2`,
      [randomUUID(), factId],
    );
    return hlc;
  }

  async factChanged(
    tx: Queryable,
    factId: string,
    kind: 'fact.reinforced' | 'fact.superseded' | 'fact.forgotten',
    payload: Record<string, unknown> = {},
  ): Promise<string> {
    const hlc = this.clock.tick();
    await tx.query('UPDATE fact SET hlc = $2 WHERE id = $1', [factId, hlc]);
    await tx.query(
      `INSERT INTO event (event_id, household_id, region, hlc, kind, payload, tombstone)
       SELECT $1, f.household_id, f.region, $2, $3, $4, $5 FROM fact f WHERE f.id = $6`,
      [randomUUID(), hlc, kind, JSON.stringify({ fact_id: factId, ...payload }), kind === 'fact.forgotten', factId],
    );
    return hlc;
  }

  /** Idempotent batch append from a device, projecting device state and sessions as it goes. */
  async ingest(ctx: HouseholdContext, device: DeviceInput, events: IncomingEvent[]): Promise<IngestResult> {
    const now = Date.now();
    const rejected: IngestResult['rejected'] = [];
    const valid: IncomingEvent[] = [];
    for (const event of events) {
      const reason = validate(event, now);
      if (reason) rejected.push({ event_id: event.event_id, reason });
      else valid.push(event);
    }
    valid.sort((a, b) => compareHlc(a.hlc, b.hlc));

    let accepted = 0;
    await this.db.transaction(async (tx) => {
      await lockHousehold(tx, ctx.householdId);
      const { rows } = await tx.query<{ state: unknown }>(
        `INSERT INTO device (household_id, device_id, region, name, location) VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (household_id, device_id) DO UPDATE SET
           last_seen_at = now(),
           name = COALESCE(EXCLUDED.name, device.name),
           location = COALESCE(EXCLUDED.location, device.location)
         RETURNING state`,
        [ctx.householdId, device.id, ctx.region, device.name ?? null, device.location ?? null],
      );
      let state = asDeviceState(rows[0]?.state);
      let stateChanged = false;
      const people = await this.people(tx, ctx.householdId);

      for (const event of valid) {
        this.clock.receive(event.hlc);
        const personId = event.person ? (people.get(event.person.toLowerCase()) ?? null) : null;
        const payload = event.payload ?? {};
        const inserted = await tx.query(
          `INSERT INTO event (event_id, household_id, region, hlc, device_id, person_id, person_confidence,
                              location, kind, payload, sensitive)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
           ON CONFLICT (event_id) DO NOTHING`,
          [
            event.event_id,
            ctx.householdId,
            ctx.region,
            event.hlc,
            device.id,
            personId,
            personId ? (event.person_confidence ?? null) : null,
            event.location ?? device.location ?? null,
            event.kind,
            JSON.stringify(payload),
            SENSITIVE_KIND.test(event.kind),
          ],
        );
        if (!inserted.rowCount) continue;
        accepted++;

        if (DEVICE_STATE_KIND.test(event.kind)) {
          state = reduceDeviceState(state, { kind: event.kind, hlc: event.hlc, payload });
          stateChanged = true;
        } else if (event.kind.startsWith('session.')) {
          await this.projectSession(tx, ctx, device.id, event, personId);
        }
      }

      if (stateChanged) {
        await tx.query('UPDATE device SET state = $3 WHERE household_id = $1 AND device_id = $2', [
          ctx.householdId,
          device.id,
          JSON.stringify(state),
        ]);
      }
    });

    return { accepted, duplicates: valid.length - accepted, rejected };
  }

  /** Events since the device's cursor, or a snapshot when the cursor predates what's still kept. */
  async sync(ctx: HouseholdContext, deviceId: string, cursor: number, limit = SYNC_PAGE): Promise<SyncResult> {
    const { rows: households } = await this.db.query<{ compacted_through: string }>(
      'SELECT compacted_through FROM household WHERE id = $1',
      [ctx.householdId],
    );
    const compactedThrough = Number(households[0]?.compacted_through ?? 0);

    let result: SyncResult;
    if (cursor < compactedThrough) {
      const { rows } = await this.db.query<{ seq: string; data: ProjectionState }>(
        'SELECT seq, data FROM snapshot WHERE household_id = $1 ORDER BY seq DESC LIMIT 1',
        [ctx.householdId],
      );
      const snapshot = rows[0];
      if (!snapshot) throw new Error('Event log was compacted without a snapshot');
      result = { mode: 'snapshot', snapshot: snapshot.data, next_cursor: Number(snapshot.seq), has_more: true };
    } else {
      const { rows } = await this.db.query<EventRow>(
        `SELECT seq, event_id, hlc, kind, device_id, person_id, payload FROM event
          WHERE household_id = $1 AND seq > $2 AND NOT sensitive
          ORDER BY seq LIMIT $3`,
        [ctx.householdId, cursor, limit + 1],
      );
      const page = rows.slice(0, limit).map(toSyncEvent);
      result = { mode: 'replay', events: page, next_cursor: page.at(-1)?.seq ?? cursor, has_more: rows.length > limit };
    }

    await this.db.query(
      `INSERT INTO device (household_id, device_id, region, last_cursor) VALUES ($1, $2, $3, $4)
       ON CONFLICT (household_id, device_id) DO UPDATE SET last_cursor = EXCLUDED.last_cursor, last_seen_at = now()`,
      [ctx.householdId, deviceId, ctx.region, result.next_cursor],
    );
    return result;
  }

  private async people(tx: Queryable, householdId: string): Promise<Map<string, string>> {
    const { rows } = await tx.query<{ id: string; name: string }>(
      `SELECT p.id, lower(p.display_name) AS name FROM membership m JOIN person p ON p.id = m.person_id
        WHERE m.household_id = $1 AND m.revoked_at IS NULL`,
      [householdId],
    );
    const people = new Map<string, string>();
    for (const row of rows) {
      people.set(row.id, row.id);
      people.set(row.name, row.id);
    }
    return people;
  }

  private async projectSession(
    tx: Queryable,
    ctx: HouseholdContext,
    deviceId: string,
    event: IncomingEvent,
    personId: string | null,
  ): Promise<void> {
    const p = event.payload ?? {};
    const sessionId = text(p.session_id);
    const at = hlcWallTime(event.hlc)?.toISOString();
    if (!sessionId || !UUID.test(sessionId) || !at) return;

    // Opened on first sight (a turn can arrive first); a session id owned by another household is ignored below.
    await tx.query(
      `INSERT INTO session (id, household_id, region, device_id, person_id, opened_at, last_turn_at)
       VALUES ($1, $2, $3, $4, $5, $6, $6) ON CONFLICT (id) DO NOTHING`,
      [sessionId, ctx.householdId, ctx.region, deviceId, personId, at],
    );

    if (event.kind === 'session.turn') {
      const role = p.role === 'user' || p.role === 'assistant' ? p.role : null;
      const said = text(p.text);
      if (!role || !said) return;
      const turn = await tx.query(
        `INSERT INTO session_turn (event_id, session_id, household_id, role, text, hlc, at)
         SELECT $1, s.id, s.household_id, $3, $4, $5, $6 FROM session s WHERE s.id = $2 AND s.household_id = $7
         ON CONFLICT (event_id) DO NOTHING`,
        [event.event_id, sessionId, role, said.slice(0, MAX_TURN_TEXT), event.hlc, at, ctx.householdId],
      );
      if (turn.rowCount) {
        await tx.query(
          `UPDATE session SET last_turn_at = GREATEST(last_turn_at, $2), person_id = COALESCE(person_id, $3)
            WHERE id = $1 AND household_id = $4`,
          [sessionId, at, personId, ctx.householdId],
        );
      }
    } else if (event.kind === 'session.close') {
      await tx.query('UPDATE session SET closed_at = $2 WHERE id = $1 AND household_id = $3', [
        sessionId,
        at,
        ctx.householdId,
      ]);
    }
  }
}

function validate(event: IncomingEvent, nowMs: number): string | null {
  if (!UUID.test(event.event_id)) return 'event_id must be a UUID';
  if (!KIND.test(event.kind)) return 'kind must look like "area.action"';
  if (RESERVED_KIND.test(event.kind)) return `kind "${event.kind}" is reserved: memory changes go through the tools`;
  const hlc = parseHlc(event.hlc);
  if (!hlc) return 'hlc must be <13-digit ms>-<5-digit counter>-<node>';
  if (hlc.wall > nowMs + MAX_FUTURE_DRIFT_MS) return 'hlc is more than 5 minutes ahead of the server clock';
  return null;
}

function toSyncEvent(row: EventRow): SyncEvent {
  return {
    seq: Number(row.seq),
    event_id: row.event_id,
    hlc: row.hlc,
    kind: row.kind,
    device_id: row.device_id,
    person_id: row.person_id,
    payload: row.payload,
  };
}
