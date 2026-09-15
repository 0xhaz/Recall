import {
  BedrockRuntimeClient,
  type ContentBlock,
  ConverseCommand,
  type Message,
  type Tool,
} from '@aws-sdk/client-bedrock-runtime';
import type { AgentModel, ModelMessage, ModelTool, ToolCall } from './agent.js';

/**
 * The Alexa+ stand-in on Bedrock, for the deployed demo: the same agent loop, a model that can be
 * reached from AWS. Converse keeps system prompts apart, requires turns to alternate, and pairs
 * every tool call with a result by id — none of which Ollama's shape carries, so it is rebuilt here.
 */

/** Converse correlates a call with its result by id; the agent's own shape has none, so they are numbered. */
const idFor = (turn: number, index: number) => `call_${turn}_${index}`;

/**
 * The SDK types tool schemas and tool inputs as DocumentType, a recursive JSON value it does not
 * re-export. A plain JSON object is one; TypeScript cannot see that through Record<string, unknown>.
 */
type ToolSchema = NonNullable<NonNullable<Tool['toolSpec']>['inputSchema']>;
type JsonDoc = ToolSchema['json'];

export function toConverse(messages: readonly ModelMessage[]): { system: string[]; turns: Message[] } {
  const system: string[] = [];
  const turns: Message[] = [];
  // Which ids the last assistant turn handed out, so the tool results that follow can match them.
  let pending: string[] = [];

  messages.forEach((m, i) => {
    if (m.role === 'system') {
      system.push(m.content);
      return;
    }
    if (m.role === 'assistant') {
      const content: ContentBlock[] = [];
      if (m.content.trim()) content.push({ text: m.content });
      pending = (m.tool_calls ?? []).map((call, j) => {
        const id = idFor(i, j);
        content.push({
          toolUse: { toolUseId: id, name: call.function.name, input: call.function.arguments as JsonDoc },
        });
        return id;
      });
      if (content.length > 0) turns.push({ role: 'assistant', content });
      return;
    }
    if (m.role === 'tool') {
      // A tool result is a user turn in Converse. Several in a row belong in one turn.
      const id = pending.shift() ?? idFor(i, 0);
      const block: ContentBlock = { toolResult: { toolUseId: id, content: [{ text: m.content }] } };
      const last = turns.at(-1);
      if (last?.role === 'user' && last.content?.some((c) => 'toolResult' in c)) last.content.push(block);
      else turns.push({ role: 'user', content: [block] });
      return;
    }
    turns.push({ role: 'user', content: [{ text: m.content }] });
  });

  if (turns[0]?.role === 'assistant') turns.unshift({ role: 'user', content: [{ text: 'Continue.' }] });
  return { system, turns };
}

const toToolConfig = (tools: readonly ModelTool[]): Tool[] =>
  tools.map((t) => ({
    toolSpec: {
      name: t.function.name,
      description: t.function.description || t.function.name,
      inputSchema: { json: t.function.parameters } as ToolSchema,
    },
  }));

export class BedrockAgentModel implements AgentModel {
  private readonly client: BedrockRuntimeClient;

  constructor(
    region: string,
    readonly model: string,
  ) {
    this.client = new BedrockRuntimeClient({ region });
  }

  async chat(messages: ModelMessage[], tools: ModelTool[]): Promise<{ content: string; tool_calls: ToolCall[] }> {
    const { system, turns } = toConverse(messages);
    const out = await this.client.send(
      new ConverseCommand({
        modelId: this.model,
        messages: turns,
        ...(system.length > 0 ? { system: system.map((text) => ({ text })) } : {}),
        inferenceConfig: { temperature: 0.2 },
        ...(tools.length > 0 ? { toolConfig: { tools: toToolConfig(tools) } } : {}),
      }),
    );

    const content = (out.output && 'message' in out.output ? out.output.message?.content : undefined) ?? [];
    const text = content
      .map((block) => ('text' in block ? block.text : ''))
      .join('')
      .trim();
    const tool_calls: ToolCall[] = content.flatMap((block) =>
      'toolUse' in block && block.toolUse?.name
        ? [
            {
              function: {
                name: block.toolUse.name,
                arguments: (block.toolUse.input ?? {}) as Record<string, unknown>,
              },
            },
          ]
        : [],
    );
    return { content: text, tool_calls };
  }
}
