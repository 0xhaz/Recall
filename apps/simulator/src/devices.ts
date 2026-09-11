import { randomUUID } from 'node:crypto';
import { formatHlc, hlcWallTime, MemoryProjection, type ProjectionState, type SyncEvent } from '@recall/core';
import type { DeviceInfo, Producer } from './config.js';
import type { RecallApi } from './recall.js';

// Simulated Echo devices. Each keeps its own view of household memory by syncing the event log
// (so a forget reaching every device is visible side by side), carries out the commands Recall
// sends, and reports what it did — Recall never assumes a device changed (architecture.md §5).

/** Matches the server's SESSION_TTL_MINUTES: after this, a new conversation starts. */
const SESSION_IDLE_MS = 10 * 60_000;
const KEEP = 20;
const MAX_PAGES = 50;

interface SyncPage {
  mode: 'replay' | 'snapshot';
  events?: SyncEvent[];
  snapshot?: ProjectionState;
  has_more: boolean;
}

export interface DeviceCommand {
  kind: string;
  payload: Record<string, unknown>;
}

export interface Notice {
  id: string;
  text: string;
  kind: string;
  audience: string;
  at: string;
}

export interface DeviceView extends DeviceInfo {
  cursor: number;
  facts: { content: string; scope: string }[];
  rules: string[];
  state: unknown;
  notices: Notice[];
  commands: { text: string; at: string }[];
  error?: string;
}

let counter = 0;
const stamp = (node: string) => {
  counter = (counter + 1) % 100_000;
  return formatHlc({ wall: Date.now(), counter, node });
};

export class SimDevice {
  private projection = new MemoryProjection();
  private session: { id: string; last: number } | null = null;
  private syncing: Promise<void> | null = null;
  private readonly notices: Notice[] = [];
  private readonly commands: { text: string; at: string }[] = [];

  constructor(
    readonly info: DeviceInfo,
    private readonly recall: RecallApi,
    private readonly onEvent: (e: SyncEvent) => Promise<void>,
  ) {}

  /** Pull the log after this device's cursor; start over from a snapshot once the log it needs is compacted. */
  sync(): Promise<void> {
    this.syncing ??= this.pull().finally(() => {
      this.syncing = null;
    });
    return this.syncing;
  }

  async view(): Promise<DeviceView> {
    const base = { ...this.info, notices: this.notices, commands: this.commands };
    try {
      await this.sync();
      const state = await this.recall.call<{ devices: { state: unknown }[] }>('device_state', { device: this.info.id });
      return {
        ...base,
        cursor: this.projection.cursor,
        facts: this.projection.currentFacts().map((f) => ({ content: f.content, scope: f.scope_type })),
        rules: this.projection.currentRules().map((r) => r.text),
        state: state.devices[0]?.state ?? null,
      };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      return { ...base, cursor: this.projection.cursor, facts: [], rules: [], state: null, error };
    }
  }

  /** The conversation log goes to Recall too: session_history and handoff read it. */
  async recordTurns(speaker: string | null, confidence: number, said: string, reply: string): Promise<void> {
    const now = Date.now();
    if (!this.session || now - this.session.last > SESSION_IDLE_MS) this.session = { id: randomUUID(), last: now };
    this.session.last = now;
    const session = this.session.id;
    const turn = (role: 'user' | 'assistant', text: string) => ({
      event_id: randomUUID(),
      hlc: stamp(this.info.id),
      kind: 'session.turn',
      ...(speaker ? { person: speaker, person_confidence: confidence } : {}),
      payload: { session_id: session, role, text },
    });
    await this.report([turn('user', said), turn('assistant', reply)]);
  }

  /** Do what Recall asked, then say so: the report is what changes device_state. */
  async carryOut(command: DeviceCommand): Promise<void> {
    await this.report([
      { event_id: randomUUID(), hlc: stamp(this.info.id), kind: command.kind, payload: command.payload },
    ]);
    const title = typeof command.payload.title === 'string' ? ` “${command.payload.title}”` : '';
    this.commands.unshift({ text: `${command.kind}${title}`, at: new Date().toISOString() });
    this.commands.splice(KEEP);
  }

  notify(n: Notice): void {
    this.notices.unshift(n);
    this.notices.splice(KEEP);
  }

  private async report(events: Record<string, unknown>[]): Promise<void> {
    await this.recall.call('ingest_events', {
      device: { id: this.info.id, name: this.info.name, location: this.info.location },
      events,
    });
  }

  private async pull(): Promise<void> {
    for (let page = 0; page < MAX_PAGES; page++) {
      const res = await this.recall.call<SyncPage>('sync', { device: this.info.id, cursor: this.projection.cursor });
      if (res.mode === 'snapshot' && res.snapshot) {
        this.projection = new MemoryProjection(res.snapshot);
      } else {
        for (const e of res.events ?? []) {
          this.projection.apply(e);
          await this.onEvent(e);
        }
      }
      if (!res.has_more) break;
    }
  }
}

/** The simulated household: its devices, and what reaches the family (notices) or a device (commands). */
export class SimHome {
  /** Where the last conversation happened: commands that name no device go there. */
  lastActive: string;
  private readonly devices: Map<string, SimDevice>;
  private readonly started = Date.now();
  private readonly seen = new Set<string>();
  private readonly feed: Notice[] = [];

  constructor(
    private readonly recall: RecallApi,
    infos: readonly DeviceInfo[],
  ) {
    this.devices = new Map(infos.map((info) => [info.id, new SimDevice(info, recall, (e) => this.onEvent(e))]));
    this.lastActive = infos[0]?.id ?? '';
  }

  device(id: string): SimDevice {
    const device = this.devices.get(id);
    if (!device) throw new Error(`No simulated device ${id}`);
    return device;
  }

  async views(): Promise<{ devices: DeviceView[]; notices: Notice[] }> {
    const devices = await Promise.all([...this.devices.values()].map((d) => d.view()));
    return { devices, notices: this.feed };
  }

  /** A simulated Ring, lights, phone or appliance reports something. */
  async produce(p: Producer): Promise<number> {
    const res = await this.recall.call<{ accepted: number }>('ingest_events', {
      device: { id: p.device, ...(p.location ? { location: p.location } : {}) },
      events: [
        {
          event_id: randomUUID(),
          hlc: stamp(p.device),
          kind: p.kind,
          ...(p.person ? { person: p.person } : {}),
          ...(p.payload ? { payload: p.payload } : {}),
        },
      ],
    });
    return res.accepted;
  }

  /** Every device sees every event; each one is acted on once, and only if it's new since start. */
  private async onEvent(e: SyncEvent): Promise<void> {
    if ((hlcWallTime(e.hlc)?.getTime() ?? 0) < this.started || this.seen.has(e.event_id)) return;
    this.seen.add(e.event_id);
    const p = e.payload;

    if (e.kind === 'notice.created') {
      const notice: Notice = {
        id: String(p.notice_id ?? e.event_id),
        text: String(p.text ?? ''),
        kind: String(p.kind ?? ''),
        audience: String(p.audience ?? ''),
        at: hlcWallTime(e.hlc)?.toISOString() ?? new Date().toISOString(),
      };
      const target = notice.audience === 'person' && e.device_id ? this.devices.get(e.device_id) : undefined;
      if (target) target.notify(notice);
      else {
        this.feed.unshift(notice);
        this.feed.splice(KEEP);
      }
      return;
    }

    if (e.kind === 'action.executed' || e.kind === 'action.undone') {
      const command = p.command as DeviceCommand | null | undefined;
      if (!command?.kind) return;
      const target = this.devices.get(String(p.device_id ?? '')) ?? this.devices.get(this.lastActive);
      await target?.carryOut({ kind: command.kind, payload: command.payload ?? {} });
    }
  }
}
