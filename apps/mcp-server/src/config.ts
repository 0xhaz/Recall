export const APP_CONFIG = Symbol('APP_CONFIG');

export interface AppConfig {
  port: number;
  host: string;
  databaseUrl: string;
  /** Below this, a named speaker is treated as unknown: household facts only, and ask (architecture.md §1.3). */
  speakerConfidenceThreshold: number;
  /** Run the extraction worker in this process. Tests turn it off and drain jobs by hand. */
  extractionWorker: boolean;
  /** Where magic links point (the console arrives in week 5). */
  consoleBaseUrl: string;
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
    speakerConfidenceThreshold: Number(env.SPEAKER_CONFIDENCE_THRESHOLD ?? 0.7),
    extractionWorker: env.EXTRACTION_WORKER !== 'off',
    consoleBaseUrl: env.CONSOLE_BASE_URL ?? 'http://localhost:3000',
  };
}
