import { BedrockProvider } from './bedrock.js';
import { BedrockEmbedder } from './bedrock-embedder.js';
import { OllamaEmbedder, OllamaProvider } from './ollama.js';
import type { Embedder, LlmProvider } from './provider.js';

export { BedrockProvider } from './bedrock.js';
export { BedrockEmbedder } from './bedrock-embedder.js';
export { OllamaEmbedder, OllamaProvider } from './ollama.js';
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

export function createEmbedder(env: NodeJS.ProcessEnv = process.env): Embedder {
  const provider = env.EMBEDDING_PROVIDER ?? env.LLM_PROVIDER ?? 'ollama';
  switch (provider) {
    case 'ollama':
      return new OllamaEmbedder(
        env.OLLAMA_BASE_URL ?? 'http://localhost:11434',
        env.OLLAMA_EMBED_MODEL ?? 'qwen3-embedding:0.6b',
      );
    case 'bedrock':
      return new BedrockEmbedder(
        env.AWS_REGION ?? 'us-east-1',
        env.BEDROCK_EMBED_MODEL_ID ?? 'amazon.titan-embed-text-v2:0',
      );
    default:
      throw new Error(`Unknown EMBEDDING_PROVIDER "${provider}" (expected ollama | bedrock)`);
  }
}
