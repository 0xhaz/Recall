import { describe, expect, it } from 'vitest';
import type { ModelMessage } from './agent.js';
import { toConverse } from './bedrock-model.js';

describe('toConverse', () => {
  it('lifts the system prompt out and leaves the question as the first turn', () => {
    const { system, turns } = toConverse([
      { role: 'system', content: 'You are Alexa+.' },
      { role: 'user', content: 'What should we cook tonight?' },
    ]);
    expect(system).toEqual(['You are Alexa+.']);
    expect(turns).toEqual([{ role: 'user', content: [{ text: 'What should we cook tonight?' }] }]);
  });

  it('pairs each tool call with its result by id, as Converse requires', () => {
    const messages: ModelMessage[] = [
      { role: 'user', content: 'Remember I am off coffee' },
      { role: 'assistant', content: '', tool_calls: [{ function: { name: 'remember', arguments: { text: 'x' } } }] },
      { role: 'tool', tool_name: 'remember', content: '{"stored":true}' },
    ];
    const { turns } = toConverse(messages);
    expect(turns).toHaveLength(3);

    const use = turns[1]?.content?.[0];
    const result = turns[2]?.content?.[0];
    const id = use && 'toolUse' in use ? use.toolUse?.toolUseId : undefined;
    expect(id).toBeTruthy();
    // The result has to carry the same id, or Bedrock rejects the conversation.
    expect(result && 'toolResult' in result ? result.toolResult?.toolUseId : null).toBe(id);
    expect(turns[2]?.role).toBe('user');
  });

  it('gathers several tool results into one turn', () => {
    const { turns } = toConverse([
      { role: 'user', content: 'go' },
      {
        role: 'assistant',
        content: '',
        tool_calls: [{ function: { name: 'a', arguments: {} } }, { function: { name: 'b', arguments: {} } }],
      },
      { role: 'tool', tool_name: 'a', content: '1' },
      { role: 'tool', tool_name: 'b', content: '2' },
    ]);
    expect(turns).toHaveLength(3);
    expect(turns[2]?.content).toHaveLength(2);
  });

  it('keeps text that arrives beside a tool call, and drops an empty assistant turn', () => {
    const withText = toConverse([
      { role: 'user', content: 'go' },
      { role: 'assistant', content: 'thinking', tool_calls: [{ function: { name: 'a', arguments: {} } }] },
    ]);
    expect(withText.turns[1]?.content).toHaveLength(2);

    const empty = toConverse([
      { role: 'user', content: 'go' },
      { role: 'assistant', content: '' },
    ]);
    expect(empty.turns).toHaveLength(1);
  });
});
