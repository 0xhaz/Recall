import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { EMBEDDING_DIMENSIONS, type Embedder, LlmNotConfiguredError } from './provider.js';

/**
 * Titan Text Embeddings V2 at 1024 dimensions, matching the fact.embedding column (migration 0002).
 *
 * Two differences from the local model, both of which matter:
 *  - Titan embeds one text per call, so a batch is N calls; they go out in small waves rather than
 *    all at once, because extraction embeds a whole statement's worth of facts at a time.
 *  - It has no query instruction. Qwen3-Embedding puts questions and facts on a shared scale by
 *    prefixing one; Titan does not, so similarity lands on a different scale and SIMILARITY_FLOOR
 *    has to be measured against Titan before it means anything (see docs/workplan.md WS13).
 */

const CONCURRENCY = 8;

interface TitanReply {
  embedding?: number[];
  embeddingsByType?: { float?: number[] };
}

export class BedrockEmbedder implements Embedder {
  readonly dimensions = EMBEDDING_DIMENSIONS;
  private readonly client: BedrockRuntimeClient;

  constructor(
    readonly region: string,
    readonly model: string,
  ) {
    this.client = new BedrockRuntimeClient({ region });
  }

  /** `purpose` is ignored: Titan has no query instruction, and inventing one would skew the scale. */
  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    const out: number[][] = new Array(texts.length);
    for (let i = 0; i < texts.length; i += CONCURRENCY) {
      const wave = texts.slice(i, i + CONCURRENCY);
      const vectors = await Promise.all(wave.map((text) => this.one(text)));
      vectors.forEach((vector, j) => {
        out[i + j] = vector;
      });
    }
    return out;
  }

  private async one(text: string): Promise<number[]> {
    const res = await this.client.send(
      new InvokeModelCommand({
        modelId: this.model,
        contentType: 'application/json',
        accept: 'application/json',
        body: JSON.stringify({ inputText: text, dimensions: this.dimensions, normalize: true }),
      }),
    );
    const body = JSON.parse(new TextDecoder().decode(res.body)) as TitanReply;
    const vector = body.embedding ?? body.embeddingsByType?.float;
    if (!vector) throw new LlmNotConfiguredError(`${this.model} returned no embedding`);
    if (vector.length !== this.dimensions) {
      throw new LlmNotConfiguredError(
        `${this.model} returned ${vector.length} dimensions, but fact.embedding is ${this.dimensions}`,
      );
    }
    return vector;
  }
}
