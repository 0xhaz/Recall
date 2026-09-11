import { describe, expect, it } from 'vitest';
import { type FactView, MemoryProjection, type SyncEvent } from './projection.js';

const fact = (id: string, content: string, extra: Partial<FactView> = {}): FactView => ({
  id,
  scope_type: 'person',
  scope_id: 'alice',
  type: 'semantic',
  content,
  confidence: 0.9,
  sensitivity: 'none',
  valid_from: '2026-09-11T00:00:00Z',
  expires_at: null,
  hlc: '',
  ...extra,
});

let seq = 0;
const event = (hlc: string, kind: string, payload: Record<string, unknown>): SyncEvent => ({
  seq: ++seq,
  event_id: `e${seq}`,
  hlc,
  kind,
  device_id: null,
  person_id: null,
  payload,
});

const created = (hlc: string, f: FactView) => event(hlc, 'fact.created', { fact: f });

describe('MemoryProjection', () => {
  it('builds current facts and tracks the cursor', () => {
    const p = new MemoryProjection();
    p.applyAll([created('1', fact('a', 'Alice is vegetarian')), created('2', fact('b', 'Alice likes jazz'))]);
    expect(p.currentFacts().map((f) => f.content)).toEqual(['Alice is vegetarian', 'Alice likes jazz']);
    expect(p.cursor).toBe(seq);
  });

  it('never lets a stale replay resurrect a forgotten fact', () => {
    const p = new MemoryProjection();
    const diet = fact('d', 'Alice is on a diet');
    p.apply(created('1', diet));
    p.apply(event('3', 'fact.forgotten', { fact_id: 'd' }));
    p.apply(created('1', diet)); // replayed from a stale device's cache
    p.apply(created('4', diet)); // even with a newer stamp, the id stays dead
    expect(p.currentFacts()).toEqual([]);
    expect(p.snapshot().removed.d).toEqual({ hlc: '3', reason: 'forgotten' });
  });

  it('applies reinforcement only when newer, and drops superseded facts', () => {
    const p = new MemoryProjection();
    p.apply(created('1', fact('a', 'Alice is vegetarian', { confidence: 0.5 })));
    p.apply(event('3', 'fact.reinforced', { fact_id: 'a', confidence: 0.6 }));
    p.apply(event('2', 'fact.reinforced', { fact_id: 'a', confidence: 0.2 })); // older, ignored
    expect(p.currentFacts()[0]?.confidence).toBe(0.6);

    p.apply(event('4', 'fact.superseded', { fact_id: 'a', superseded_by: 'b' }));
    p.apply(created('5', fact('b', 'Alice is vegan')));
    expect(p.currentFacts().map((f) => f.content)).toEqual(['Alice is vegan']);
  });

  it('hides expired facts', () => {
    const p = new MemoryProjection();
    p.apply(created('1', fact('t', 'Alice is in Penang', { expires_at: '2026-09-16T16:00:00Z' })));
    expect(p.currentFacts(new Date('2026-09-15T00:00:00Z'))).toHaveLength(1);
    expect(p.currentFacts(new Date('2026-09-17T00:00:00Z'))).toHaveLength(0);
  });

  it('continues from a snapshot exactly as if it had replayed everything', () => {
    const full = new MemoryProjection();
    const events = [
      created('1', fact('a', 'one')),
      created('2', fact('b', 'two')),
      event('3', 'fact.forgotten', { fact_id: 'a' }),
      created('4', fact('c', 'three')),
    ];
    full.applyAll(events);

    const partial = new MemoryProjection();
    partial.applyAll(events.slice(0, 3));
    const resumed = new MemoryProjection(partial.snapshot());
    resumed.applyAll(events.slice(3));
    expect(resumed.snapshot()).toEqual(full.snapshot());
  });
});
