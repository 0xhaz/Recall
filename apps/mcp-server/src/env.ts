import { fileURLToPath } from 'node:url';

/** Load the repo-root .env in local dev. Existing env vars win; missing file is fine (containers). */
export function loadDotEnv(): void {
  try {
    process.loadEnvFile(fileURLToPath(new URL('../../../.env', import.meta.url)));
  } catch {
    // no .env — rely on the real environment
  }
}
