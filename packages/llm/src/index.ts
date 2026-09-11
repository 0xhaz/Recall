import { BedrockProvider } from './bedrock.js';
import { OllamaProvider } from './ollama.js';
import type { LlmProvider } from './provider.js';

export { BedrockProvider } from './bedrock.js';
export { OllamaProvider } from './ollama.js';
export * from './provider.js';

export function createLlmProvider(env: NodeJS.ProcessEnv = process.env): LlmProvider {
  const provider = env.LLM_PROVIDER ?? 'ollama';
  switch (provider) {
    case 'ollama':
      return new OllamaProvider(env.OLLAMA_BASE_URL ?? 'http://localhost:11434', env.OLLAMA_MODEL ?? 'qwen3:8b');
    case 'bedrock':
      return new BedrockProvider(env.AWS_REGION ?? 'us-east-1', env.BEDROCK_MODEL_ID ?? 'amazon.nova-lite-v1:0');
    default:
      throw new Error(`Unknown LLM_PROVIDER "${provider}" (expected ollama | bedrock)`);
  }
}
