import { describe, expect, it } from 'vitest';
import { scopeRank, toTsQuery } from './memory.service.js';

describe('scopeRank', () => {
  const me = 'p1';
  const mine = { scope_type: 'person', scope_id: me } as const;
  const hers = { scope_type: 'person', scope_id: 'p2' } as const;
  const house = { scope_type: 'household', scope_id: 'h1' } as const;

  it("puts the speaker's own facts ahead of household ones", () => {
    // Why this exists: "Aisyah is vegetarian" scored 0.313 against a 0.34 floor, so it never
    // ranked at all — and a PII delivery address scoring 0.183 was shown above it.
    expect(scopeRank(mine, me)).toBeLessThan(scopeRank(house, me));
    expect([house, mine].sort((a, b) => scopeRank(a, me) - scopeRank(b, me))).toEqual([mine, house]);
  });

  it("leads with the speaker's own fact even when it never cleared the floor", () => {
    // The partition search() applies: own facts first, everything else after, order kept within.
    const partition = <T>(rows: T[], rank: (r: T) => number) => [
      ...rows.filter((r) => rank(r) === 0),
      ...rows.filter((r) => rank(r) !== 0),
    ];
    // As they arrive: two household facts that matched, then the unmatched tail.
    const byRelevance = [house, house, mine, hers];
    expect(partition(byRelevance, (r) => scopeRank(r, me))).toEqual([mine, house, house, hers]);
  });

  it('does not promote another person’s fact, and is inert with no speaker', () => {
    expect(scopeRank(hers, me)).toEqual(scopeRank(house, me));
    expect(scopeRank(mine, null)).toEqual(scopeRank(house, null));
  });
});

describe('toTsQuery', () => {
  it('ORs prefix terms and drops short words', () => {
    expect(toTsQuery('What should we cook tonight?')).toBe('what:* | should:* | cook:* | tonight:*');
  });

  it('strips tsquery operators so user text cannot inject syntax', () => {
    expect(toTsQuery("dinner & (rice | !noodles):* <-> 'x'")).toBe('dinner:* | rice:* | noodles:*');
  });

  it('keeps non-English letters', () => {
    expect(toTsQuery('makan malam nasi')).toBe('makan:* | malam:* | nasi:*');
  });

  it('returns an empty string for an empty query', () => {
    expect(toTsQuery('  ? ')).toBe('');
  });
});
