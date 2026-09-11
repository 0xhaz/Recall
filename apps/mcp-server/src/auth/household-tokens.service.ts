import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { audit } from '../audit.js';
import { Db } from '../db/db.js';
import { HouseholdAuth } from './household-auth.js';
import { hashToken, newToken } from './tokens.js';

@Injectable()
export class HouseholdTokens {
  constructor(
    @Inject(Db) private readonly db: Db,
    @Inject(HouseholdAuth) private readonly auth: HouseholdAuth,
  ) {}

  /** Returns the plaintext token once; only its hash is kept. */
  async create(householdId: string, actorId: string, label: string): Promise<{ id: string; token: string }> {
    const token = newToken('rcl_hh');
    return this.db.transaction(async (tx) => {
      const { rows } = await tx.query<{ id: string }>(
        `INSERT INTO household_token (household_id, region, token_hash, label, created_by)
         SELECT h.id, h.region, $2, $3, $4 FROM household h WHERE h.id = $1
         RETURNING id`,
        [householdId, hashToken(token), label, actorId],
      );
      const row = rows[0];
      if (!row) throw new NotFoundException('Household not found');
      await audit(tx, {
        householdId,
        actorId,
        action: 'token.create',
        targetType: 'household_token',
        targetId: row.id,
        detail: { label },
      });
      return { id: row.id, token };
    });
  }

  async revoke(householdId: string, tokenId: string, actorId: string): Promise<boolean> {
    const revoked = await this.db.transaction(async (tx) => {
      const { rowCount } = await tx.query(
        `UPDATE household_token SET revoked_at = now()
          WHERE id = $1 AND household_id = $2 AND revoked_at IS NULL`,
        [tokenId, householdId],
      );
      if (!rowCount) return false;
      await audit(tx, {
        householdId,
        actorId,
        action: 'token.revoke',
        targetType: 'household_token',
        targetId: tokenId,
      });
      return true;
    });
    if (revoked) this.auth.invalidate();
    return revoked;
  }
}
