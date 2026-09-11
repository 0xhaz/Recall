import { describe, expect, it } from 'vitest';
import { toTsQuery } from './memory.service.js';

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
