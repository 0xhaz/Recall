import { describe, expect, it } from 'vitest';
import { extractionMessages, judgeMessages, statementMessage } from './prompt.js';

describe('extraction prompt', () => {
  const now = new Date('2026-09-11T02:00:00Z'); // Friday morning in Kuala Lumpur

  it('tells the model what day it is, and nothing it could copy as an end date', () => {
    const message = statementMessage({
      speaker: 'Aisyah',
      statement: 'I am in Penang until Wednesday',
      timezone: 'Asia/Kuala_Lumpur',
      now,
    });
    expect(message).toBe('Today: Friday 2026-09-11\nSpeaker: Aisyah\nStatement: I am in Penang until Wednesday');
  });

  it('includes one worked example before the real statement', () => {
    const messages = extractionMessages({ speaker: 'Aisyah', statement: 'hello', timezone: 'Asia/Kuala_Lumpur', now });
    expect(messages.map((m) => m.role)).toEqual(['system', 'user', 'assistant', 'user']);
    expect(messages.at(-1)?.content).toContain('Statement: hello');
    expect(messages.map((m) => m.content).join('\n')).not.toMatch(/"ends":"\d{4}-/);
  });

  it('numbers existing facts for the judge', () => {
    const [, user] = judgeMessages('Aisyah is vegan', ['Aisyah is vegetarian', 'Aisyah likes jazz']);
    expect(user?.content).toBe('New: Aisyah is vegan\nExisting:\n1. Aisyah is vegetarian\n2. Aisyah likes jazz');
  });
});
