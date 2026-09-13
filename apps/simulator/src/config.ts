import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// One .env at the repo root configures the server and the simulator alike.
const envFile = fileURLToPath(new URL('../../../.env', import.meta.url));
if (existsSync(envFile)) process.loadEnvFile(envFile);

export const config = {
  port: Number(process.env.SIM_PORT ?? 3200),
  recallUrl: process.env.RECALL_URL ?? `http://127.0.0.1:${process.env.PORT ?? 3100}/mcp`,
  token: process.env.RECALL_DEV_TOKEN ?? '',
  ollamaUrl: process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434',
  model: process.env.SIM_MODEL ?? process.env.OLLAMA_MODEL ?? 'qwen3:8b',
  timezone: process.env.SIM_TIMEZONE ?? 'Asia/Kuala_Lumpur',
};

export interface DeviceInfo {
  id: string;
  name: string;
  location: string;
}

/** The demo household from `pnpm db:seed`: who can speak, and the devices on the table. */
export const DEMO = {
  people: ['Aisyah', 'Daniel', 'Sofia', 'Mak Som', 'Farah', 'Ravi'],
  devices: [
    { id: 'kitchen-echo', name: 'Kitchen Echo Show', location: 'Kitchen' },
    { id: 'bedroom-echo', name: "Mak Som's Echo", location: "Mak Som's room" },
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
  { id: 'coffee', label: 'Coffee machine on', device: 'kitchen-echo', kind: 'coffee_machine.start', person: 'Aisyah' },
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
    label: "Aisyah's phone charging",
    device: 'aisyah-phone',
    kind: 'phone.charging',
    person: 'Aisyah',
    payload: { charging: true },
  },
  { id: 'arrival', label: 'Ring: someone arrives', device: 'front-door', location: 'Front door', kind: 'ring.arrival' },
  { id: 'door', label: 'Front door opens', device: 'front-door', location: 'Front door', kind: 'door.open' },
  { id: 'sleep', label: 'Mak Som goes to sleep', device: 'bedroom-echo', kind: 'sleep.start', person: 'Mak Som' },
  { id: 'wake', label: 'Mak Som wakes up', device: 'bedroom-echo', kind: 'sleep.end', person: 'Mak Som' },
  // Mak Som's Bee: worn, never spoken to. Only derived context outlives the 7-day window.
  {
    id: 'bee-resting',
    label: 'Bee: Mak Som resting (72 bpm)',
    device: 'som-bee',
    kind: 'hr.sample',
    person: 'Mak Som',
    payload: { bpm: 72 },
  },
  {
    id: 'bee-up',
    label: 'Bee: Mak Som up and about',
    device: 'som-bee',
    kind: 'phone.motion',
    person: 'Mak Som',
    payload: { steps_per_min: 70 },
  },
  {
    id: 'bee-still',
    label: 'Bee: no movement',
    device: 'som-bee',
    kind: 'phone.motion',
    person: 'Mak Som',
    payload: { steps_per_min: 0 },
  },
];
