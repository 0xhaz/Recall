import type { ChatRequest, ChatResponse, LlmProvider } from './provider.js';

interface OllamaChatReply {
  model: string;
  message: { content: string };
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
