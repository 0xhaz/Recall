import { Inject, Injectable } from '@nestjs/common';
import { Db } from '../db/db.js';

/** A session is "active" while turns keep coming; after this it is history (architecture.md §4). */
export const SESSION_TTL_MINUTES = 10;
const MAX_TURNS = 50;

export interface Turn {
  role: 'user' | 'assistant';
  text: string;
  at: string;
}

export interface SessionView {
  session_id: string;
  device_id: string;
  person_id: string | null;
  opened_at: string;
  last_turn_at: string;
  active: boolean;
  turns: Turn[];
}

interface SessionRow {
  id: string;
  device_id: string;
  person_id: string | null;
  opened_at: Date;
  last_turn_at: Date;
  active: boolean;
}

const SESSION_COLUMNS = `id, device_id, person_id, opened_at, last_turn_at,
  (closed_at IS NULL AND last_turn_at > now() - make_interval(mins => ${SESSION_TTL_MINUTES})) AS active`;

/** The actual turn log: the only source for any claim about what was said (architecture.md §5). */
@Injectable()
export class SessionService {
  constructor(@Inject(Db) private readonly db: Db) {}

  /** A specific session, or the device's most recent one. */
  async history(householdId: string, opts: { sessionId?: string; deviceId?: string }): Promise<SessionView | null> {
    const { rows } = opts.sessionId
      ? await this.db.query<SessionRow>(`SELECT ${SESSION_COLUMNS} FROM session WHERE household_id = $1 AND id = $2`, [
          householdId,
          opts.sessionId,
        ])
      : await this.db.query<SessionRow>(
          `SELECT ${SESSION_COLUMNS} FROM session WHERE household_id = $1 AND device_id = $2
            ORDER BY last_turn_at DESC LIMIT 1`,
          [householdId, opts.deviceId ?? ''],
        );
    const session = rows[0];
    return session ? this.withTurns(session) : null;
  }

  /**
   * The conversation a device should continue: its own active session, or failing that the
   * speaker's active session on another device (handoff).
   */
  async active(householdId: string, deviceId: string, personId: string | null): Promise<SessionView | null> {
    const { rows } = await this.db.query<SessionRow>(
      `SELECT ${SESSION_COLUMNS} FROM session
        WHERE household_id = $1 AND closed_at IS NULL
          AND last_turn_at > now() - make_interval(mins => ${SESSION_TTL_MINUTES})
          AND (device_id = $2 OR ($3::uuid IS NOT NULL AND person_id = $3::uuid))
        ORDER BY (device_id = $2) DESC, last_turn_at DESC
        LIMIT 1`,
      [householdId, deviceId, personId],
    );
    const session = rows[0];
    return session ? this.withTurns(session) : null;
  }

  /** Everything a person said and heard since a time, across sessions and devices (care mode's repeat window). */
  async turnsSince(householdId: string, personId: string, since: Date): Promise<Turn[]> {
    const { rows } = await this.db.query<{ role: Turn['role']; text: string; at: Date }>(
      `SELECT t.role, t.text, t.at FROM session_turn t JOIN session s ON s.id = t.session_id
        WHERE t.household_id = $1 AND s.person_id = $2 AND t.at >= $3
        ORDER BY t.at, t.hlc LIMIT 200`,
      [householdId, personId, since],
    );
    return rows.map((t) => ({ role: t.role, text: t.text, at: t.at.toISOString() }));
  }

  private async withTurns(session: SessionRow): Promise<SessionView> {
    const { rows } = await this.db.query<{ role: Turn['role']; text: string; at: Date }>(
      'SELECT role, text, at FROM session_turn WHERE session_id = $1 ORDER BY hlc DESC LIMIT $2',
      [session.id, MAX_TURNS],
    );
    return {
      session_id: session.id,
      device_id: session.device_id,
      person_id: session.person_id,
      opened_at: session.opened_at.toISOString(),
      last_turn_at: session.last_turn_at.toISOString(),
      active: session.active,
      turns: rows.reverse().map((t) => ({ role: t.role, text: t.text, at: t.at.toISOString() })),
    };
  }
}
