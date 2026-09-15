import { describe, expect, it } from 'vitest';
import { extractionMessages, judgeMessages, statementMessage } from './prompt.js';

describe('extraction prompt', () => {
  const now = new Date('2026-09-11T14:00:00Z'); // Friday morning in Brooklyn

  it('tells the model what day it is, and nothing it could copy as an end date', () => {
    const message = statementMessage({
      speaker: 'Emma',
      statement: 'I am in Boston until Wednesday',
      timezone: 'America/New_York',
      now,
    });
    expect(message).toBe('Today: Friday 2026-09-11\nSpeaker: Emma\nStatement: I am in Boston until Wednesday');
  });

  it('includes one worked example before the real statement', () => {
    const messages = extractionMessages({ speaker: 'Emma', statement: 'hello', timezone: 'America/New_York', now });
    expect(messages.map((m) => m.role)).toEqual(['system', 'user', 'assistant', 'user']);
    expect(messages.at(-1)?.content).toContain('Statement: hello');
    expect(messages.map((m) => m.content).join('\n')).not.toMatch(/"ends":"\d{4}-/);
  });

  it('numbers existing facts for the judge', () => {
    const [, user] = judgeMessages('Emma is vegan', ['Emma is vegetarian', 'Emma likes jazz']);
    expect(user?.content).toBe('New: Emma is vegan\nExisting:\n1. Emma is vegetarian\n2. Emma likes jazz');
  });
});
