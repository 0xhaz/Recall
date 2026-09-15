import { describe, expect, it } from 'vitest';
import { reshape } from './bedrock.js';
import { BedrockProvider, createLlmProvider, OllamaProvider } from './index.js';

describe('createLlmProvider', () => {
  it('defaults to Ollama with qwen3:8b', () => {
    const provider = createLlmProvider({});
    expect(provider).toBeInstanceOf(OllamaProvider);
    expect(provider.model).toBe('qwen3:8b');
  });

  it('switches to Bedrock on env only', () => {
    const provider = createLlmProvider({ LLM_PROVIDER: 'bedrock', AWS_REGION: 'us-east-1' });
    expect(provider).toBeInstanceOf(BedrockProvider);
    expect(provider.model).toBe('amazon.nova-lite-v1:0');
  });

  it('rejects unknown providers', () => {
    expect(() => createLlmProvider({ LLM_PROVIDER: 'gpt' })).toThrow(/Unknown LLM_PROVIDER/);
  });
});

describe('reshape (Bedrock Converse)', () => {
  it('lifts system prompts out of the turns', () => {
    const { system, turns } = reshape([
      { role: 'system', content: 'You extract facts.' },
      { role: 'user', content: 'I am off coffee.' },
    ]);
    expect(system).toEqual(['You extract facts.']);
    expect(turns).toEqual([{ role: 'user', content: [{ text: 'I am off coffee.' }] }]);
  });

  it('folds consecutive turns in the same role, which Converse rejects', () => {
    const { turns } = reshape([
      { role: 'user', content: 'first' },
      { role: 'user', content: 'second' },
      { role: 'assistant', content: 'ok' },
    ]);
    expect(turns).toEqual([
      { role: 'user', content: [{ text: 'first\n\nsecond' }] },
      { role: 'assistant', content: [{ text: 'ok' }] },
    ]);
  });

  it('never opens with an assistant turn: a reply is not a request', () => {
    const { turns } = reshape([{ role: 'assistant', content: 'Half a thought' }]);
    expect(turns[0]?.role).toBe('user');
    expect(turns).toHaveLength(2);
  });

  it('keeps several system prompts in order, and drops nothing', () => {
    const { system, turns } = reshape([
      { role: 'system', content: 'one' },
      { role: 'user', content: 'q' },
      { role: 'system', content: 'two' },
    ]);
    expect(system).toEqual(['one', 'two']);
    expect(turns).toHaveLength(1);
  });
});
