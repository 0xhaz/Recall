// The console drives the simulated Alexa+ (apps/simulator) over its own HTTP API rather than
// carrying a second agent loop: one implementation of "speak to Recall", used from both places.

const SIM = process.env.SIMULATOR_URL ?? 'http://127.0.0.1:3200';
/** Reads are quick; a spoken turn waits on a local model, which can take half a minute. */
const READ_TIMEOUT_MS = 3_000;
const SAY_TIMEOUT_MS = 120_000;

/** The simulator isn't running. Worth saying plainly: it is a separate `pnpm sim`. */
export class SimulatorOffline extends Error {}

export interface SimConfig {
  people: string[];
  devices: { id: string; name: string; location: string }[];
  producers: { id: string; label: string }[];
  replays: { name: string; description: string; mode: string }[];
  model: string;
  recall: string;
}

export interface SimStep {
  tool: string;
  args: Record<string, unknown>;
  ms: number;
  result: unknown;
  error?: string;
}

export interface SimReply {
  reply: string;
  steps: SimStep[];
  speaker: { name: string; role: string } | null;
  ask_who: boolean;
  model_ms: number;
}

export interface SimNotice {
  id: string;
  text: string;
  kind: string;
  audience: string;
  at: string;
}

export interface SimDevice {
  id: string;
  name: string;
  location: string;
  cursor: number;
  facts: { content: string; scope: string }[];
  rules: string[];
  state: {
    now_playing?: { title: string; paused: boolean; source?: string | null } | null;
    timers?: { label: string | null; remaining_s: number }[];
  } | null;
  notices: SimNotice[];
  commands: { text: string; at: string }[];
  error?: string;
}

async function sim<T>(path: string, options: { body?: unknown; timeout?: number } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${SIM}${path}`, {
      method: options.body === undefined ? 'GET' : 'POST',
      cache: 'no-store',
      signal: AbortSignal.timeout(options.timeout ?? READ_TIMEOUT_MS),
      ...(options.body === undefined
        ? {}
        : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(options.body) }),
    });
  } catch {
    // Connection refused or timed out: from here it is simply not there.
    throw new SimulatorOffline(`No simulator answering on ${SIM}. Start it with \`pnpm sim\`.`);
  }
  const text = await res.text();
  const body: unknown = text ? JSON.parse(text) : {};
  if (!res.ok) throw new Error((body as { error?: string }).error ?? res.statusText);
  return body as T;
}

export const getSimConfig = () => sim<SimConfig>('/api/config');
export const getSimDevices = () => sim<{ devices: SimDevice[]; notices: SimNotice[] }>('/api/devices');

export const saySomething = (utterance: { device: string; speaker: string | null; confidence: number; text: string }) =>
  sim<SimReply>('/api/say', { body: utterance, timeout: SAY_TIMEOUT_MS });
