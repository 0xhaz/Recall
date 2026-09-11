import {
  type ChatRequest,
  type ChatResponse,
  EMBEDDING_DIMENSIONS,
  type Embedder,
  type LlmProvider,
} from './provider.js';

interface OllamaChatReply {
  model: string;
  message: { content: string };
  prompt_eval_count?: number;
  eval_count?: number;
}

export class OllamaProvider implements LlmProvider {
  readonly name = 'ollama';

  constructor(
    private readonly baseUrl: string,
    readonly model: string,
  ) {}

  async chat(request: ChatRequest): Promise<ChatResponse> {
    const started = performance.now();
    const res = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        stream: false,
        // Think mode costs seconds per call; extraction doesn't need it (techstack.md §3).
        think: false,
        messages: request.messages,
        format: request.jsonSchema,
        options: {
          temperature: request.temperature ?? 0,
          num_predict: request.maxTokens,
        },
      }),
    });
    if (!res.ok) {
      throw new Error(`Ollama ${res.status}: ${await res.text()}`);
    }
    const body = (await res.json()) as OllamaChatReply;
    return {
      text: body.message.content,
      model: body.model,
      latencyMs: Math.round(performance.now() - started),
      inputTokens: body.prompt_eval_count ?? 0,
      outputTokens: body.eval_count ?? 0,
    };
  }

  async ping(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/api/version`, { signal: AbortSignal.timeout(1000) });
      return res.ok;
    } catch {
      return false;
    }
  }
}

export class OllamaEmbedder implements Embedder {
  readonly dimensions = EMBEDDING_DIMENSIONS;

  constructor(
    private readonly baseUrl: string,
    readonly model: string,
  ) {}

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    const res = await fetch(`${this.baseUrl}/api/embed`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: this.model, input: texts }),
    });
    if (!res.ok) {
      throw new Error(`Ollama embed ${res.status}: ${await res.text()}`);
    }
    const { embeddings } = (await res.json()) as { embeddings: number[][] };
    const wrong = embeddings.find((e) => e.length !== this.dimensions);
    if (wrong) {
      throw new Error(
        `${this.model} returned ${wrong.length} dims; the fact.embedding column expects ${this.dimensions}`,
      );
    }
    return embeddings;
  }
}
