import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { audit } from '../audit.js';
import { APP_CONFIG, type AppConfig } from '../config.js';
import { Db } from '../db/db.js';
import { EMAIL_SENDER, type EmailSender } from './email.js';
import { bearer, hashToken, newToken } from './tokens.js';

/** Magic-link sign-in for the console (design.md §9). People are global, so sessions carry no household. */
@Injectable()
export class ConsoleAuthService {
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
    await this.mail.send({
      to: email,
      subject: 'Sign in to Recall',
      text: `Hi ${person.display_name}, use this link within 15 minutes to sign in: ${url}`,
      url,
    });
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
