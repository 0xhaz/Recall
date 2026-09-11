import { createHash, randomBytes } from 'node:crypto';

export type TokenKind = 'rcl_hh' | 'rcl_login' | 'rcl_sess';

/** 256 bits of randomness with a readable prefix so leaked tokens are easy to spot. */
export function newToken(kind: TokenKind): string {
  return `${kind}_${randomBytes(32).toString('base64url')}`;
}

/** Only hashes are stored, so a database leak doesn't leak usable tokens. */
export function hashToken(token: string): Buffer {
  return createHash('sha256').update(token).digest();
}

export function bearer(authorization: string | undefined): string | null {
  return authorization?.match(/^Bearer\s+(\S+)$/i)?.[1] ?? null;
}
