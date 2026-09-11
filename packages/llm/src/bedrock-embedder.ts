import { EMBEDDING_DIMENSIONS, type Embedder, LlmNotConfiguredError } from './provider.js';

/**
 * Titan Text Embeddings V2 at 1024 dimensions, matching the local model's column size.
 * Stubbed until AWS credits land (workplan WS13).
 */
export class BedrockEmbedder implements Embedder {
  readonly dimensions = EMBEDDING_DIMENSIONS;

  constructor(
    readonly region: string,
    readonly model: string,
  ) {}

  async embed(_texts: string[]): Promise<number[][]> {
    throw new LlmNotConfiguredError(
      `Bedrock embeddings not implemented yet (${this.model}); use EMBEDDING_PROVIDER=ollama`,
    );
  }
}
