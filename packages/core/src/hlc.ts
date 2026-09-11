// Hybrid logical clock (architecture.md §4): wall time + logical counter + node id.
// Encoded as fixed-width text so string order is clock order, with ties broken on node id.

export interface Hlc {
  wall: number;
  counter: number;
  node: string;
}

const MAX_COUNTER = 99_999;
const PATTERN = /^(\d{13})-(\d{5})-([A-Za-z0-9_.:-]{1,64})$/;

export function formatHlc({ wall, counter, node }: Hlc): string {
  return `${String(wall).padStart(13, '0')}-${String(counter).padStart(5, '0')}-${node}`;
}

export function parseHlc(value: string): Hlc | null {
  const match = PATTERN.exec(value);
  if (!match?.[1] || !match[2] || !match[3]) return null;
  return { wall: Number(match[1]), counter: Number(match[2]), node: match[3] };
}

export function compareHlc(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Wall-clock part of a stamp, e.g. to show when a device says something happened. */
export function hlcWallTime(value: string): Date | null {
  const hlc = parseHlc(value);
  return hlc ? new Date(hlc.wall) : null;
}

export class HybridClock {
  private last: Hlc;

  constructor(
    readonly node: string,
    private readonly now: () => number = Date.now,
  ) {
    this.last = { wall: 0, counter: 0, node };
  }

  /** Stamp a local event. Strictly increasing, even within one millisecond or if the wall clock steps back. */
  tick(): string {
    const physical = this.now();
    this.last =
      physical > this.last.wall
        ? { wall: physical, counter: 0, node: this.node }
        : { wall: this.last.wall, counter: this.last.counter + 1, node: this.node };
    return this.stamp();
  }

  /** Merge a stamp from another node so everything this clock stamps next sorts after it. */
  receive(remote: string): string {
    const r = parseHlc(remote);
    if (!r) throw new Error(`Invalid HLC "${remote}"`);
    const wall = Math.max(this.last.wall, r.wall, this.now());
    let counter = 0;
    if (wall === this.last.wall && wall === r.wall) counter = Math.max(this.last.counter, r.counter) + 1;
    else if (wall === this.last.wall) counter = this.last.counter + 1;
    else if (wall === r.wall) counter = r.counter + 1;
    this.last = { wall, counter, node: this.node };
    return this.stamp();
  }

  private stamp(): string {
    if (this.last.counter > MAX_COUNTER) throw new Error('HLC counter overflow');
    return formatHlc(this.last);
  }
}
