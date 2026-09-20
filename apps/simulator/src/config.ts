import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// One .env at the repo root configures the server and the simulator alike.
const envFile = fileURLToPath(new URL('../../../.env', import.meta.url));
if (existsSync(envFile)) process.loadEnvFile(envFile);

export const config = {
  port: Number(process.env.SIM_PORT ?? 3200),
  /** Loopback locally; a container has to bind 0.0.0.0 or nothing outside it can connect. */
  host: process.env.SIM_HOST ?? '127.0.0.1',
  recallUrl: process.env.RECALL_URL ?? `http://127.0.0.1:${process.env.PORT ?? 3100}/mcp`,
  token: process.env.RECALL_DEV_TOKEN ?? '',
  ollamaUrl: process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434',
  model: process.env.SIM_MODEL ?? process.env.OLLAMA_MODEL ?? 'qwen3:8b',
  timezone: process.env.SIM_TIMEZONE ?? 'America/New_York',
  /** Which model answers: ollama locally, bedrock once deployed (there is no Ollama on AWS). */
  provider: process.env.SIM_LLM_PROVIDER ?? process.env.LLM_PROVIDER ?? 'ollama',
  region: process.env.AWS_REGION ?? 'us-east-1',
  bedrockModel: process.env.SIM_BEDROCK_MODEL_ID ?? 'amazon.nova-lite-v1:0',
  /**
   * The spoken voice. Alexa's own is not available outside Amazon, so this is Polly — the same TTS
   * family — with `Joanna` as the nearest familiar register. Set SIM_VOICE=off for silence.
   */
  voice: process.env.SIM_VOICE ?? 'Joanna',
  voiceEngine: process.env.SIM_VOICE_ENGINE ?? 'generative',
};

export interface DeviceInfo {
  id: string;
  name: string;
  location: string;
}

/** The demo household from `pnpm db:seed`: who can speak, and the devices on the table. */
export const DEMO = {
  people: ['Emma', 'Daniel', 'Sofia', 'Ruth', 'Nina', 'Tom'],
  devices: [
    { id: 'kitchen-echo', name: 'Kitchen Echo Show', location: 'Kitchen' },
    { id: 'bedroom-echo', name: "Ruth's Echo", location: "Ruth's room" },
    { id: 'living-firetv', name: 'Living room Fire TV', location: 'Living room' },
  ] satisfies DeviceInfo[],
};

export interface Producer {
  id: string;
  label: string;
  device: string;
  location?: string;
  kind: string;
  person?: string;
  payload?: Record<string, unknown>;
}

/** Simulated Ring, Fire TV, coffee machine, lights and phone: one button, one device report. */
export const PRODUCERS: Producer[] = [
  { id: 'coffee', label: 'Coffee machine on', device: 'kitchen-echo', kind: 'coffee_machine.start', person: 'Emma' },
  { id: 'music-stop', label: 'Stop the music', device: 'kitchen-echo', kind: 'media.stop' },
  {
    id: 'lights-dim',
    label: 'Living room lights dim',
    device: 'living-lights',
    location: 'Living room',
    kind: 'lights.living.dim',
    payload: { brightness: 20 },
  },
  {
    id: 'lights-on',
    label: 'Living room lights on',
    device: 'living-lights',
    location: 'Living room',
    kind: 'lights.living.on',
    payload: { brightness: 90 },
  },
  {
    id: 'charging',
    label: "Emma's phone charging",
    device: 'emma-phone',
    kind: 'phone.charging',
    person: 'Emma',
    payload: { charging: true },
  },
  { id: 'arrival', label: 'Ring: someone arrives', device: 'front-door', location: 'Front door', kind: 'ring.arrival' },
  { id: 'door', label: 'Front door opens', device: 'front-door', location: 'Front door', kind: 'door.open' },
  { id: 'sleep', label: 'Ruth goes to sleep', device: 'bedroom-echo', kind: 'sleep.start', person: 'Ruth' },
  { id: 'wake', label: 'Ruth wakes up', device: 'bedroom-echo', kind: 'sleep.end', person: 'Ruth' },
  // Ruth's Bee: worn, never spoken to. Only derived context outlives the 7-day window.
  {
    id: 'bee-resting',
    label: 'Bee: Ruth resting (72 bpm)',
    device: 'ruth-bee',
    kind: 'hr.sample',
    person: 'Ruth',
    payload: { bpm: 72 },
  },
  {
    id: 'bee-up',
    label: 'Bee: Ruth up and about',
    device: 'ruth-bee',
    kind: 'phone.motion',
    person: 'Ruth',
    payload: { steps_per_min: 70 },
  },
  {
    id: 'bee-still',
    label: 'Bee: no movement',
    device: 'ruth-bee',
    kind: 'phone.motion',
    person: 'Ruth',
    payload: { steps_per_min: 0 },
  },
];
