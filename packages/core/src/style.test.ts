import { describe, expect, it } from 'vitest';
import { reciprocalRankFusion } from './fusion.js';
import { DEFAULT_STYLE, resolveStyle } from './style.js';

describe('resolveStyle', () => {
  it('is terse with no commentary by default', () => {
    expect(resolveStyle({})).toEqual(DEFAULT_STYLE);
    expect(resolveStyle(null)).toEqual(DEFAULT_STYLE);
  });

  it('applies valid preferences and ignores the rest', () => {
    expect(resolveStyle({ verbosity: 'normal', humour: true, commentary: 'yes', loud: true })).toEqual({
      ...DEFAULT_STYLE,
      verbosity: 'normal',
      humour: true,
    });
  });
});

describe('reciprocalRankFusion', () => {
  it('rewards ids that rank well in several lists', () => {
    const scores = reciprocalRankFusion([
      ['a', 'b', 'c'],
      ['b', 'd'],
    ]);
    const order = [...scores.entries()].sort((x, y) => y[1] - x[1]).map(([id]) => id);
    expect(order).toEqual(['b', 'a', 'd', 'c']);
  });
});
