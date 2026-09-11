import type { FactType, ScopeType, SensitivityTag } from './types.js';

// The memory view a device derives from the event log (architecture.md §4). Devices never
// merge state with each other: they replay events from the server, and tombstones always win.

export interface FactView {
  id: string;
  scope_type: ScopeType;
  scope_id: string;
  type: FactType;
  content: string;
  confidence: number;
  sensitivity: SensitivityTag;
  valid_from: string;
  expires_at: string | null;
  hlc: string;
}

export interface SyncEvent {
  seq: number;
  event_id: string;
  hlc: string;
  kind: string;
  device_id: string | null;
  person_id: string | null;
  payload: Record<string, unknown>;
}

export interface ProjectionState {
  /** Server sequence number of the last event applied; the device's sync cursor. */
  cursor: number;
  facts: Record<string, FactView>;
  /** Facts that must never come back: forgotten (tombstones) or superseded. */
  removed: Record<string, { hlc: string; reason: 'forgotten' | 'superseded' }>;
}

export function emptyProjection(): ProjectionState {
  return { cursor: 0, facts: {}, removed: {} };
}

export class MemoryProjection {
  private readonly state: ProjectionState;

  constructor(state: ProjectionState = emptyProjection()) {
    this.state = structuredClone(state);
  }

  get cursor(): number {
    return this.state.cursor;
  }

  apply(event: SyncEvent): void {
    this.state.cursor = Math.max(this.state.cursor, event.seq);
    const p = event.payload;
    switch (event.kind) {
      case 'fact.created': {
        const fact = p.fact as FactView | undefined;
        // A stale replay of a forgotten fact must not resurrect it.
        if (!fact || this.state.removed[fact.id]) return;
        const current = this.state.facts[fact.id];
        if (!current || current.hlc < event.hlc) this.state.facts[fact.id] = { ...fact, hlc: event.hlc };
        return;
      }
      case 'fact.reinforced': {
        const fact = this.state.facts[String(p.fact_id)];
        if (fact && fact.hlc < event.hlc) {
          fact.confidence = Number(p.confidence);
          fact.hlc = event.hlc;
        }
        return;
      }
      case 'fact.superseded':
        this.remove(String(p.fact_id), event.hlc, 'superseded');
        return;
      case 'fact.forgotten':
        this.remove(String(p.fact_id), event.hlc, 'forgotten');
        return;
      default:
        return;
    }
  }

  applyAll(events: Iterable<SyncEvent>): void {
    for (const event of events) this.apply(event);
  }

  /** Facts true now, in a stable order. */
  currentFacts(now: Date = new Date()): FactView[] {
    return Object.values(this.state.facts)
      .filter((f) => !f.expires_at || Date.parse(f.expires_at) > now.getTime())
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  snapshot(): ProjectionState {
    return structuredClone(this.state);
  }

  private remove(id: string, hlc: string, reason: 'forgotten' | 'superseded'): void {
    delete this.state.facts[id];
    const previous = this.state.removed[id];
    if (!previous || previous.hlc < hlc) this.state.removed[id] = { hlc, reason };
  }
}
