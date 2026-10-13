import { Inject, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { audit } from '../audit.js';
import { APP_CONFIG, type AppConfig } from '../config.js';
import { Db } from '../db/db.js';
import { DEMO_HOUSEHOLD_ID } from '../db/seed-ids.js';
import { EMAIL_SENDER, type EmailSender } from './email.js';
import { bearer, hashToken, newToken } from './tokens.js';

/** Magic-link sign-in for the console (design.md §9). People are global, so sessions carry no household. */
@Injectable()
export class ConsoleAuthService {
  private readonly logger = new Logger(ConsoleAuthService.name);

  constructor(
    @Inject(Db) private readonly db: Db,
    @Inject(EMAIL_SENDER) private readonly mail: EmailSender,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** Resolves the same way whether or not the email exists, so accounts can't be enumerated. */
  async requestLink(email: string): Promise<void> {
    const { rows } = await this.db.query<{ id: string; display_name: string }>(
      'SELECT id, display_name FROM person WHERE lower(email) = lower($1)',
      [email],
    );
    const person = rows[0];
    if (!person) return;

    const token = newToken('rcl_login');
    await this.db.query(
      `INSERT INTO login_token (person_id, token_hash, expires_at) VALUES ($1, $2, now() + interval '15 minutes')`,
      [person.id, hashToken(token)],
    );
    const url = `${this.config.consoleBaseUrl}/auth/verify?token=${encodeURIComponent(token)}`;
    try {
      await this.mail.send({
        to: email,
        subject: 'Sign in to Recall',
        text: `Hi ${person.display_name}, use this link within 15 minutes to sign in: ${url}`,
        url,
      });
    } catch (err) {
      // The caller answers the same way whether or not the address is known, so a delivery failure
      // must not become a 500: that difference is exactly how you find out who has an account.
      // It is logged instead, where the people running the server can see it.
      this.logger.error(`could not send the sign-in link: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /** Exchanges a single-use link for a 30-day session. Null when the link is unknown, used or expired. */
  async verify(token: string): Promise<{ session_token: string; expires_at: string } | null> {
    return this.db.transaction(async (tx) => {
      const { rows } = await tx.query<{ person_id: string }>(
        `UPDATE login_token SET used_at = now()
          WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()
          RETURNING person_id`,
        [hashToken(token)],
      );
      const login = rows[0];
      if (!login) return null;

      const session = newToken('rcl_sess');
      const inserted = await tx.query<{ expires_at: Date }>(
        `INSERT INTO console_session (person_id, token_hash, expires_at)
         VALUES ($1, $2, now() + interval '30 days') RETURNING expires_at`,
        [login.person_id, hashToken(session)],
      );
      await audit(tx, {
        householdId: null,
        actorId: login.person_id,
        action: 'console.sign_in',
        targetType: 'person',
        targetId: login.person_id,
      });
      return { session_token: session, expires_at: String(inserted.rows[0]?.expires_at.toISOString()) };
    });
  }

  /** Whether this deployment offers demo sign-in at all. */
  async demoOffered(): Promise<boolean> {
    return this.config.demoSignIn;
  }

  /**
   * One-click sign-in for judging and demos. Two things make this safe to expose:
   *
   *  - it is off unless DEMO_SIGN_IN=on, and
   *  - the person is looked up **by household id**, never by anything the caller sends. There is no
   *    input that can point it at another household, so the worst it can reach is seeded fiction.
   *
   * `person` only picks among that household's own adults and caregiver, so a judge can see the
   * same memory from an owner's, an adult's and a carer's seat — which is the access model working,
   * not a shortcut around it. Children, guests and the cared-for person are not sign-in accounts.
   * The session is short: this is for a look around, not a login people keep.
   */
  async demoSession(person?: string): Promise<{ session_token: string; expires_at: string; name: string } | null> {
    if (!this.config.demoSignIn) return null;
    return this.db.transaction(async (tx) => {
      const { rows } = await tx.query<{ id: string; display_name: string }>(
        `SELECT p.id, p.display_name
           FROM membership m JOIN person p ON p.id = m.person_id
          WHERE m.household_id = $1 AND m.revoked_at IS NULL AND m.role IN ('owner', 'adult', 'caregiver')
            AND ($2::text IS NULL OR lower(p.display_name) = lower($2))
          ORDER BY (m.role = 'owner') DESC, p.display_name
          LIMIT 1`,
        [DEMO_HOUSEHOLD_ID, person ?? null],
      );
      const who = rows[0];
      if (!who) return null;

      const session = newToken('rcl_sess');
      const inserted = await tx.query<{ expires_at: Date }>(
        `INSERT INTO console_session (person_id, token_hash, expires_at)
         VALUES ($1, $2, now() + interval '1 day') RETURNING expires_at`,
        [who.id, hashToken(session)],
      );
      // Logged like any other sign-in, and distinguishable from one, so the log stays honest.
      await audit(tx, {
        householdId: DEMO_HOUSEHOLD_ID,
        actorId: who.id,
        action: 'console.demo_sign_in',
        targetType: 'person',
        targetId: who.id,
      });
      this.logger.log(`demo sign-in as ${who.display_name}`);
      return {
        session_token: session,
        expires_at: String(inserted.rows[0]?.expires_at.toISOString()),
        name: who.display_name,
      };
    });
  }

  async requirePerson(authorization: string | undefined): Promise<string> {
    const token = bearer(authorization);
    if (!token) throw new UnauthorizedException();
    const { rows } = await this.db.query<{ person_id: string }>(
      `SELECT person_id FROM console_session
        WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > now()`,
      [hashToken(token)],
    );
    const session = rows[0];
    if (!session) throw new UnauthorizedException();
    return session.person_id;
  }
}
