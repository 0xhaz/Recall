import { createHash, timingSafeEqual } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config.js';

export interface HouseholdContext {
  householdId: string;
}

/**
 * Week-1 auth: one dev bearer token mapped to the demo household.
 * Week 2 replaces this with per-household tokens (workplan WS1).
 */
@Injectable()
export class HouseholdAuth {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  authenticate(authorization: string | undefined): HouseholdContext | null {
    const expected = this.config.devToken;
    if (!expected) return { householdId: this.config.devHouseholdId };

    const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
    if (!token || !sameSecret(token, expected)) return null;
    return { householdId: this.config.devHouseholdId };
  }
}

function sameSecret(a: string, b: string): boolean {
  const digest = (s: string) => createHash('sha256').update(s).digest();
  return timingSafeEqual(digest(a), digest(b));
}
