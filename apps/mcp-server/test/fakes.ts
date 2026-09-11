import {
  type ChatRequest,
  type ChatResponse,
  EMBEDDING_DIMENSIONS,
  type Embedder,
  type LlmProvider,
} from '@recall/llm';

/** Answers each chat call with whatever the test's responder returns, serialised as JSON. */
export class ScriptedLlm implements LlmProvider {
  readonly name = 'scripted';
  readonly model = 'scripted';
  readonly calls: ChatRequest[] = [];

  constructor(private readonly respond: (request: ChatRequest) => unknown) {}

  async chat(request: ChatRequest): Promise<ChatResponse> {
    this.calls.push(request);
    return {
      text: JSON.stringify(this.respond(request)),
      model: this.model,
      latencyMs: 0,
      inputTokens: 100,
      outputTokens: 20,
    };
  }

  async ping(): Promise<boolean> {
    return true;
  }
}

/**
 * Deterministic embedder: words in the same topic group land on the same dimension, so
 * "vegetarian" and "vegan" come out near-identical, while other words only add a small
 * hashed bag-of-words component. Enough to drive the dedupe path without a model.
 */
export class TopicEmbedder implements Embedder {
  readonly model = 'topic';
  readonly dimensions = EMBEDDING_DIMENSIONS;

  constructor(
    private readonly topics: string[][] = [['vegetarian', 'vegan', 'meat', 'fish'], ['coffee'], ['pray', 'prays']],
  ) {}

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((text) => this.vector(text));
  }

  private vector(text: string): number[] {
    const v = new Array<number>(this.dimensions).fill(0);
    for (const word of text.toLowerCase().match(/[a-z]+/g) ?? []) {
      const topic = this.topics.findIndex((group) => group.includes(word));
      if (topic >= 0) v[topic] = (v[topic] ?? 0) + 3;
      const slot = 16 + (hash(word) % (this.dimensions - 16));
      v[slot] = (v[slot] ?? 0) + 0.3;
    }
    const norm = Math.hypot(...v) || 1;
    return v.map((x) => x / norm);
  }
}

function hash(word: string): number {
  let h = 2166136261;
  for (const ch of word) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  return h;
}
