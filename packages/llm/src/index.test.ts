import { describe, expect, it } from 'vitest';
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
