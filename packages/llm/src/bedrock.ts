import {
  BedrockRuntimeClient,
  type ContentBlock,
  ConverseCommand,
  type Message,
  type Tool,
} from '@aws-sdk/client-bedrock-runtime';
import {
  type ChatMessage,
  type ChatRequest,
  type ChatResponse,
  LlmNotConfiguredError,
  type LlmProvider,
} from './provider.js';

/**
 * Bedrock via the Converse API (Nova Lite for extraction). Converse keeps system prompts in their
 * own field and requires the rest to alternate, so the flat ChatMessage[] is reshaped here rather
 * than at every call site.
 */

/** Converse has no `format` field: a schema is enforced by forcing one tool call and reading its input. */
const SCHEMA_TOOL = 'respond';

/**
 * The SDK types this as DocumentType — a recursive JSON value the package does not re-export.
 * A JSON Schema object is one, but TypeScript cannot see that through Record<string, unknown>.
 */
type ToolSchema = NonNullable<NonNullable<Tool['toolSpec']>['inputSchema']>;

/** Exported for tests: the reshaping is where this adapter can quietly go wrong. */
export function reshape(messages: readonly ChatMessage[]): { system: string[]; turns: Message[] } {
  const system: string[] = [];
  const turns: Message[] = [];
  for (const m of messages) {
    if (m.role === 'system') {
      system.push(m.content);
      continue;
    }
    const last = turns.at(-1);
    // Converse rejects two turns in the same role: fold them together instead.
    if (last?.role === m.role) {
      last.content = [{ text: `${last.content?.[0]?.text ?? ''}\n\n${m.content}` }];
      continue;
    }
    turns.push({ role: m.role, content: [{ text: m.content }] });
  }
  // A conversation has to start with the user; a lone assistant turn is not a request.
  if (turns[0]?.role === 'assistant') turns.unshift({ role: 'user', content: [{ text: 'Continue.' }] });
  return { system, turns };
}

const textOf = (content: ContentBlock[] | undefined): string =>
  (content ?? [])
    .map((block) => ('text' in block ? block.text : ''))
    .join('')
    .trim();

/** The forced tool call carries the structured answer as its input; JSON.stringify returns it to the caller. */
function structuredOf(content: ContentBlock[] | undefined): string | null {
  for (const block of content ?? []) {
    if ('toolUse' in block && block.toolUse?.name === SCHEMA_TOOL) return JSON.stringify(block.toolUse.input ?? {});
  }
  return null;
}

export class BedrockProvider implements LlmProvider {
  readonly name = 'bedrock';
  private readonly client: BedrockRuntimeClient;

  constructor(
    readonly region: string,
    readonly model: string,
  ) {
    this.client = new BedrockRuntimeClient({ region });
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    const started = performance.now();
    const { system, turns } = reshape(request.messages);
    if (turns.length === 0) throw new LlmNotConfiguredError('Bedrock chat needs at least one user message');

    const tool: Tool | null = request.jsonSchema
      ? {
          toolSpec: {
            name: SCHEMA_TOOL,
            description: 'Return the answer in this shape.',
            inputSchema: { json: request.jsonSchema } as ToolSchema,
          },
        }
      : null;

    const out = await this.client.send(
      new ConverseCommand({
        modelId: this.model,
        messages: turns,
        ...(system.length > 0 ? { system: system.map((text) => ({ text })) } : {}),
        inferenceConfig: {
          temperature: request.temperature ?? 0,
          ...(request.maxTokens ? { maxTokens: request.maxTokens } : {}),
        },
        ...(tool ? { toolConfig: { tools: [tool], toolChoice: { tool: { name: SCHEMA_TOOL } } } } : {}),
      }),
    );

    const content = out.output && 'message' in out.output ? out.output.message?.content : undefined;
    const text = (tool ? structuredOf(content) : null) ?? textOf(content);
    return {
      text,
      model: this.model,
      latencyMs: Math.round(performance.now() - started),
      inputTokens: out.usage?.inputTokens ?? 0,
      outputTokens: out.usage?.outputTokens ?? 0,
    };
  }

  /**
   * Credentials only. /health is polled, and every Converse call costs money and tokens, so this
   * answers "is this process able to call Bedrock at all" — the failure that actually happens —
   * without invoking a model.
   */
  async ping(): Promise<boolean> {
    try {
      const resolve = this.client.config.credentials;
      if (typeof resolve !== 'function') return false;
      const credentials = await resolve();
      return Boolean(credentials?.accessKeyId);
    } catch {
      return false;
    }
  }
}
