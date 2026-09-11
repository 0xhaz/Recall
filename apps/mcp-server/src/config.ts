import { DEMO_HOUSEHOLD_ID } from './db/seed-ids.js';

export const APP_CONFIG = Symbol('APP_CONFIG');

export interface AppConfig {
  port: number;
  host: string;
  databaseUrl: string;
  /** Week-1 single bearer token; replaced by per-household tokens in week 2. Empty = no check. */
  devToken: string | undefined;
  devHouseholdId: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required (see .env.example)');
  }
  return {
    port: Number(env.PORT ?? 3100),
    host: env.HOST ?? '127.0.0.1',
    databaseUrl,
    devToken: env.RECALL_DEV_TOKEN || undefined,
    devHouseholdId: env.RECALL_DEV_HOUSEHOLD_ID ?? DEMO_HOUSEHOLD_ID,
  };
}
