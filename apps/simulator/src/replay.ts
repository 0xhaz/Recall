import { randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { addDays, formatHlc, formatMinute, isWeekend, temporalStamp } from '@recall/core';
import type { RecallApi } from './recall.js';

// Replays (techstack.md §2): JSON streams of device reports with fake device ids, stamped with
// HLCs as they are sent. "history" lays weeks of routine into the past in one go; "live" plays a
// recording now, in real time (or faster with --speed), so the context engine sees it happen.

export interface ReplayEvent {
  device: string;
  kind: string;
  person?: string;
  location?: string;
  payload?: Record<string, unknown>;
}

export interface LiveReplay {
  name: string;
  description: string;
  mode: 'live';
  events?: (ReplayEvent & { at_s: number })[];
  /** A recorded signal: one value every `every_s` seconds, sent as { [field]: value }. */
  series?: (Omit<ReplayEvent, 'payload'> & { field: string; every_s: number; start_s?: number; values: number[] })[];
}

export interface HistoryReplay {
  name: string;
  description: string;
  mode: 'history';
  days: number;
  daily: (ReplayEvent & {
    /** Household-local HH:MM. */
    time: string;
    jitter_min?: number;
    weekdays_only?: boolean;
    /** Only on the last N days. */
    last_days?: number;
    /** The last N occurrences are reported as failed (payload.status): a routine that stopped working. */
    failed_last?: number;
  })[];
}

export type Replay = LiveReplay | HistoryReplay;

export interface IncomingEvent {
  event_id: string;
  hlc: string;
  kind: string;
  person?: string;
  payload?: Record<string, unknown>;
}

const DIR = new URL('../replays/', import.meta.url);
const NAME = /^[a-z0-9-]{1,40}$/;
const BATCH = 200;
let counter = 0;

/** The same jitter every run, so a replay always lays down the same history. */
function seeded(seed: string): () => number {
  let h = 2166136261;
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
}

export function expandHistory(r: HistoryReplay, timezone: string, now: Date): (ReplayEvent & { at: Date })[] {
  const today = temporalStamp(timezone, now).local_date;
  const jitter = seeded(r.name);
  const out: (ReplayEvent & { at: Date })[] = [];
  for (const d of r.daily) {
    const times: Date[] = [];
    for (let back = r.days; back >= 1; back--) {
      const date = addDays(today, -back);
      const shift = Math.round((jitter() * 2 - 1) * (d.jitter_min ?? 0));
      if (d.weekdays_only && isWeekend(date)) continue;
      if (d.last_days !== undefined && back > d.last_days) continue;
      const [hours = 0, minutes = 0] = d.time.split(':').map(Number);
      const minute = Math.min(1439, Math.max(0, hours * 60 + minutes + shift));
      const offset = temporalStamp(timezone, new Date(`${date}T12:00:00Z`)).utc_offset;
      times.push(new Date(`${date}T${formatMinute(minute)}:00${offset}`));
    }
    times.forEach((at, i) => {
      const failed = d.failed_last !== undefined && i >= times.length - d.failed_last;
      out.push({
        device: d.device,
        kind: d.kind,
        ...(d.person ? { person: d.person } : {}),
        ...(d.location ? { location: d.location } : {}),
        payload: { ...d.payload, ...(failed ? { status: 'failed' } : {}) },
        at,
      });
    });
  }
  return out.sort((a, b) => a.at.getTime() - b.at.getTime());
}

export function expandLive(r: LiveReplay): (ReplayEvent & { at_s: number })[] {
  const out = [...(r.events ?? [])];
  for (const { field, every_s, start_s = 0, values, ...event } of r.series ?? []) {
    values.forEach((value, i) => {
      out.push({ ...event, payload: { [field]: value }, at_s: start_s + i * every_s });
    });
  }
  return out.sort((a, b) => a.at_s - b.at_s);
}

export function toIncoming(e: ReplayEvent, at: Date): IncomingEvent {
  counter = (counter + 1) % 100_000;
  return {
    event_id: randomUUID(),
    hlc: formatHlc({ wall: at.getTime(), counter, node: e.device }),
    kind: e.kind,
    ...(e.person ? { person: e.person } : {}),
    ...(e.payload && Object.keys(e.payload).length > 0 ? { payload: e.payload } : {}),
  };
}

export async function listReplays(): Promise<{ name: string; description: string; mode: Replay['mode'] }[]> {
  const files = (await readdir(DIR)).filter((f) => f.endsWith('.json')).sort();
  const replays = await Promise.all(files.map((f) => loadReplay(f.slice(0, -5))));
  return replays.map(({ name, description, mode }) => ({ name, description, mode }));
}

export async function loadReplay(name: string): Promise<Replay> {
  if (!NAME.test(name)) throw new Error(`No replay called ${name}`);
  const replay = JSON.parse(await readFile(new URL(`${name}.json`, DIR), 'utf8')) as Replay;
  if (replay.mode !== 'live' && replay.mode !== 'history') throw new Error(`${name}: unknown mode`);
  return replay;
}

const pause = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      resolve();
    });
  });

/** Send a replay through ingest_events. History goes in batches per device; live plays in real time. */
export async function runReplay(
  replay: Replay,
  recall: RecallApi,
  opts: { timezone: string; speed?: number; now?: Date; signal?: AbortSignal; onEvent?: (e: ReplayEvent) => void },
): Promise<{ sent: number }> {
  const ingest = async (e: ReplayEvent, events: IncomingEvent[]) => {
    const device = { id: e.device, ...(e.location ? { location: e.location } : {}) };
    return (await recall.call<{ accepted: number }>('ingest_events', { device, events })).accepted;
  };
  let sent = 0;

  if (replay.mode === 'history') {
    const events = expandHistory(replay, opts.timezone, opts.now ?? new Date());
    const byDevice = new Map<string, typeof events>();
    for (const e of events) byDevice.set(e.device, [...(byDevice.get(e.device) ?? []), e]);
    for (const group of byDevice.values()) {
      for (let i = 0; i < group.length; i += BATCH) {
        const batch = group.slice(i, i + BATCH);
        const first = batch[0];
        if (!first) continue;
        sent += await ingest(
          first,
          batch.map((e) => toIncoming(e, e.at)),
        );
        for (const e of batch) opts.onEvent?.(e);
      }
    }
    return { sent };
  }

  const speed = opts.speed && opts.speed > 0 ? opts.speed : 1;
  const start = Date.now();
  for (const e of expandLive(replay)) {
    const wait = start + (e.at_s * 1000) / speed - Date.now();
    if (wait > 0) await pause(wait, opts.signal);
    if (opts.signal?.aborted) break;
    sent += await ingest(e, [toIncoming(e, new Date())]);
    opts.onEvent?.(e);
  }
  return { sent };
}
