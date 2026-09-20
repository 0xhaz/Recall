import { describe, expect, it } from 'vitest';
import { speakable } from './voice.js';

describe('speakable', () => {
  it('passes a normal answer through, with whitespace tidied', () => {
    expect(speakable('You are  vegetarian,\n and pizza night is Friday.')).toBe(
      'You are vegetarian, and pizza night is Friday.',
    );
  });

  it('stops a long answer at a sentence end rather than mid-word', () => {
    const long = `${'She takes one tablet with food. '.repeat(10)}And then the rest of it.`;
    const said = speakable(long, 120);
    expect(said.length).toBeLessThanOrEqual(120);
    expect(said.endsWith('.')).toBe(true);
    expect(said).not.toContain('…');
  });

  it('falls back to an ellipsis when there is no sentence end to cut at', () => {
    expect(speakable('a'.repeat(200), 50)).toMatch(/…$/);
  });

  it('says nothing for nothing', () => {
    expect(speakable('   ')).toBe('');
  });
});
