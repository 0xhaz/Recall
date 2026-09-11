// LlmProvider: the one seam between Recall and any model. Local (Ollama) for iteration,
// Bedrock for the final week — switching is an env var, not a refactor (techstack.md §3).

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatRequest {
  messages: ChatMessage[];
  /** JSON Schema the reply must satisfy. Providers that support structured output enforce it. */
  jsonSchema?: Record<string, unknown>;
  temperature?: number;
  maxTokens?: number;
}

export interface ChatResponse {
  text: string;
  model: string;
  latencyMs: number;
}

export interface LlmProvider {
  readonly name: string;
  readonly model: string;
  chat(request: ChatRequest): Promise<ChatResponse>;
  /** Cheap reachability check for /health — never loads a model. */
  ping(): Promise<boolean>;
}

export class LlmNotConfiguredError extends Error {}
