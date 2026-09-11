import { describe, expect, it } from 'vitest';
import { compareHlc, formatHlc, HybridClock, hlcWallTime, parseHlc } from './hlc.js';

describe('HLC encoding', () => {
  it('round-trips and sorts as text in clock order', () => {
    const a = formatHlc({ wall: 1_757_600_000_000, counter: 2, node: 'kitchen-echo' });
    expect(a).toBe('1757600000000-00002-kitchen-echo');
    expect(parseHlc(a)).toEqual({ wall: 1_757_600_000_000, counter: 2, node: 'kitchen-echo' });

    const later = formatHlc({ wall: 1_757_600_000_000, counter: 10, node: 'a' });
    expect(compareHlc(a, later)).toBe(-1);
    expect(compareHlc(later, a)).toBe(1);
  });

  it('breaks exact ties on node id', () => {
    const a = formatHlc({ wall: 5, counter: 0, node: 'bedroom' });
    const b = formatHlc({ wall: 5, counter: 0, node: 'kitchen' });
    expect([b, a].sort()).toEqual([a, b]);
  });

  it('rejects malformed stamps', () => {
    expect(parseHlc('yesterday')).toBeNull();
    expect(parseHlc('123-00000-x')).toBeNull();
    expect(hlcWallTime('1757600000000-00000-x')?.toISOString()).toBe('2025-09-11T14:13:20.000Z');
  });
});

describe('HybridClock', () => {
  it('stays strictly increasing within a millisecond and when the wall clock steps back', () => {
    let now = 1000;
    const clock = new HybridClock('server', () => now);
    const a = clock.tick();
    const b = clock.tick();
    now = 900; // clock stepped back
    const c = clock.tick();
    expect([a, b, c]).toEqual([
      '0000000001000-00000-server',
      '0000000001000-00001-server',
      '0000000001000-00002-server',
    ]);
  });

  it('orders local events after a remote stamp from a clock that runs ahead', () => {
    const clock = new HybridClock('server', () => 1000);
    const remote = formatHlc({ wall: 5000, counter: 3, node: 'phone' });
    clock.receive(remote);
    expect(compareHlc(clock.tick(), remote)).toBe(1);
  });

  it('refuses garbage', () => {
    expect(() => new HybridClock('server').receive('nope')).toThrow(/Invalid HLC/);
  });
});
