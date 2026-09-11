import { Inject, Injectable } from '@nestjs/common';
import { Db } from '../db/db.js';
import { bearer, hashToken } from './tokens.js';

export interface HouseholdContext {
  householdId: string;
  region: string;
}

const HIT_TTL_MS = 60_000;
const MISS_TTL_MS = 5_000;
const MAX_ENTRIES = 1_000;

/**
 * Resolves an MCP bearer token to its household. Lookups are cached so auth stays off the
 * latency path; revoking clears this instance's cache, other instances catch up within a minute.
 */
@Injectable()
export class HouseholdAuth {
  private readonly cache = new Map<string, { ctx: HouseholdContext | null; expires: number }>();

  constructor(@Inject(Db) private readonly db: Db) {}

  async authenticate(authorization: string | undefined): Promise<HouseholdContext | null> {
    const token = bearer(authorization);
    if (!token) return null;

    const hash = hashToken(token);
    const key = hash.toString('base64');
    const cached = this.cache.get(key);
    if (cached && cached.expires > Date.now()) return cached.ctx;

    const { rows } = await this.db.query<{ household_id: string; region: string }>(
      `UPDATE household_token SET last_used_at = now()
        WHERE token_hash = $1 AND revoked_at IS NULL
        RETURNING household_id, region`,
      [hash],
    );
    const row = rows[0];
    const ctx = row ? { householdId: row.household_id, region: row.region } : null;
    if (this.cache.size >= MAX_ENTRIES) this.cache.clear();
    this.cache.set(key, { ctx, expires: Date.now() + (ctx ? HIT_TTL_MS : MISS_TTL_MS) });
    return ctx;
  }

  invalidate(): void {
    this.cache.clear();
  }
}
