import type { JsonSchema, RecallApi, ToolInfo } from './recall.js';

// The Alexa+ stand-in: a local model with tool calling, whose only memory is Recall over MCP.
// The device does what Alexa+ devices do — it knows who is speaking (Voice ID) and where — so
// speaker and device are filled in here, never guessed by the model.

export interface ToolCall {
  function: { name: string; arguments: Record<string, unknown> };
}

export interface ModelMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: ToolCall[];
  tool_name?: string;
}

export interface ModelTool {
  type: 'function';
  function: { name: string; description: string; parameters: JsonSchema };
}

export interface AgentModel {
  readonly model: string;
  chat(messages: ModelMessage[], tools: ModelTool[]): Promise<{ content: string; tool_calls: ToolCall[] }>;
}

export class OllamaAgentModel implements AgentModel {
  constructor(
    private readonly baseUrl: string,
    readonly model: string,
  ) {}

  async chat(messages: ModelMessage[], tools: ModelTool[]): Promise<{ content: string; tool_calls: ToolCall[] }> {
    const res = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        stream: false,
        think: false,
        messages,
        tools,
        // Twenty tool schemas and a brief don't fit Ollama's default context.
        options: { temperature: 0.2, num_ctx: 16384 },
      }),
    });
    if (!res.ok) throw new Error(`Ollama ${res.status}: ${await res.text()}`);
    const body = (await res.json()) as { message: { content?: string; tool_calls?: ToolCall[] } };
    return { content: body.message.content ?? '', tool_calls: body.message.tool_calls ?? [] };
  }
}

/** Device plumbing, and the brief the device already fetched: never offered to the model. */
const HIDDEN = new Set(['session_brief', 'ingest_events', 'sync', 'resolve_speaker']);
/** What the device knows and fills in itself. */
const DEVICE_FILLED = ['speaker', 'speaker_confidence', 'device'];
const MAX_STEPS = 5;

export const SYSTEM_PROMPT = [
  'You are Alexa+, the voice assistant in this home. Recall is your memory, and the session brief below comes from it.',
  'Replies are spoken: one or two short sentences, plain words, no lists or markdown.',
  "Answer the new request directly, using the brief's facts. Never repeat the question back, never reuse an earlier",
  'reply (earlier_in_conversation is only context), and only ask a question when you need the answer to go on.',
  'Stated rules override everything. Follow the style, and any repeat or care guidance, exactly.',
  "Only state what the brief or a tool result says; if they don't say, say you don't know.",
  'If the speaker is unknown, ask who is speaking before using or giving anything personal; if they ask about',
  '"me" or "my", reply only by asking who is speaking.',
  'To remember something, call remember. To forget something, call forget.',
  'Before doing anything for someone (ordering, booking, playing music, changing a device), call action_preflight',
  'with exactly what they said (venue, address, items), filling in from the facts only what they left out.',
  "Then: if it is blocked, say why, quoting the rule; if there are things to confirm, ask about them and wait; if it's",
  'allowed and they asked for it, call decide_action with "confirm".',
  'Never say something is done unless decide_action returned status "executed".',
  'For what is playing, timers or alarms, call device_state first.',
].join(' ');

/** Recall's tools as the model sees them: no plumbing, and nothing the device fills in. */
export function modelTools(tools: readonly ToolInfo[]): ModelTool[] {
  return tools
    .filter((t) => !HIDDEN.has(t.name))
    .map((t) => {
      const { properties = {}, required = [], ...rest } = t.inputSchema;
      return {
        type: 'function',
        function: {
          name: t.name,
          description: t.description ?? '',
          parameters: {
            ...rest,
            type: 'object',
            properties: Object.fromEntries(Object.entries(properties).filter(([k]) => !DEVICE_FILLED.includes(k))),
            required: required.filter((k) => !DEVICE_FILLED.includes(k)),
          },
        },
      };
    });
}

export interface Utterance {
  device: string;
  speaker: string | null;
  confidence: number;
  text: string;
}

export interface Step {
  tool: string;
  args: Record<string, unknown>;
  ms: number;
  result: unknown;
  error?: string;
}

export interface Reply {
  reply: string;
  steps: Step[];
  speaker: { name: string; role: string } | null;
  ask_who: boolean;
  model_ms: number;
}

interface Brief {
  temporal?: { local_date: string; local_time: string; weekday: string; timezone: string };
  speaker?: { name: string; role: string } | null;
  ask_who_is_speaking?: boolean;
  speaker_candidate?: string;
  response_style?: Record<string, unknown>;
  rules?: { text: string }[];
  facts?: { content: string; why?: string }[];
  active_session?: { recent_turns?: { role: string; text: string }[] };
  device_state?: { now_playing?: { title: string } | null };
  contexts?: { context: string; for: string }[];
  quiet_hours?: { active: boolean };
  repeat?: unknown;
  care?: unknown;
}

/** The brief, compact: a small model answers better from a short digest than from the full JSON. */
export function digest(b: Brief): Record<string, unknown> {
  const out: Record<string, unknown> = {
    now: b.temporal && `${b.temporal.weekday} ${b.temporal.local_date} ${b.temporal.local_time.slice(0, 5)}`,
    speaker: b.speaker
      ? `${b.speaker.name} (${b.speaker.role})`
      : b.speaker_candidate
        ? `not sure: maybe ${b.speaker_candidate}; ask "Is this ${b.speaker_candidate}?" first`
        : 'unknown: ask who is speaking before anything personal',
    rules: b.rules?.map((r) => r.text),
    facts: b.facts?.map((f) => (f.why === 'pending_extraction' ? `${f.content} (just said)` : f.content)),
    style: b.response_style,
    // Context for a follow-up, not answers to reuse: small models otherwise repeat the last reply.
    earlier_in_conversation: b.active_session?.recent_turns?.slice(-4).map((t) => `${t.role}: ${t.text}`),
    playing_now: b.device_state?.now_playing?.title,
    contexts: b.contexts?.map((c) => `${c.context} (${c.for})`),
    quiet_hours: b.quiet_hours?.active === true ? 'yes: answer briefly, offer nothing' : undefined,
    repeat: b.repeat,
    care: b.care,
  };
  return Object.fromEntries(
    Object.entries(out).filter(([, v]) => v !== undefined && v !== null && !(Array.isArray(v) && v.length === 0)),
  );
}

const clean = (s: string) => s.replace(/<think>[\s\S]*?<\/think>/g, '').trim();

export class Agent {
  constructor(
    private readonly recall: RecallApi,
    private readonly model: AgentModel,
  ) {}

  async respond(u: Utterance): Promise<Reply> {
    const known = await this.recall.tools();
    const context: Record<string, unknown> = {
      ...(u.speaker ? { speaker: u.speaker, speaker_confidence: u.confidence } : {}),
      device: u.device,
    };
    const steps: Step[] = [];
    const run = async (tool: string, args: Record<string, unknown>): Promise<unknown> => {
      const accepts = known.find((t) => t.name === tool)?.inputSchema.properties ?? {};
      const filled = { ...args, ...Object.fromEntries(Object.entries(context).filter(([k]) => k in accepts)) };
      const started = performance.now();
      try {
        const result = await this.recall.call(tool, filled);
        steps.push({ tool, args: filled, ms: Math.round(performance.now() - started), result });
        return result;
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        steps.push({ tool, args: filled, ms: Math.round(performance.now() - started), result: null, error });
        return { error };
      }
    };

    // Every request starts from the brief, like the tool description asks; the device fetches it.
    const brief = (await run('session_brief', { hint: u.text })) as Brief;
    const tools = modelTools(known);
    const messages: ModelMessage[] = [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: u.text },
      {
        role: 'assistant',
        content: '',
        tool_calls: [{ function: { name: 'session_brief', arguments: { hint: u.text } } }],
      },
      { role: 'tool', tool_name: 'session_brief', content: JSON.stringify(digest(brief)) },
    ];

    let reply = '';
    let modelMs = 0;
    for (let step = 0; step < MAX_STEPS && !reply; step++) {
      const started = performance.now();
      const out = await this.model.chat(messages, tools);
      modelMs += performance.now() - started;
      if (out.tool_calls.length === 0) {
        reply = clean(out.content);
        break;
      }
      messages.push({ role: 'assistant', content: out.content, tool_calls: out.tool_calls });
      for (const call of out.tool_calls) {
        const name = call.function.name;
        const result = HIDDEN.has(name)
          ? { error: 'Not available to the assistant.' }
          : await run(name, call.function.arguments ?? {});
        messages.push({ role: 'tool', tool_name: name, content: JSON.stringify(result) });
      }
    }
    return {
      reply: reply || "Sorry, I couldn't finish that.",
      steps,
      speaker: brief?.speaker ?? null,
      ask_who: brief?.ask_who_is_speaking === true,
      model_ms: Math.round(modelMs),
    };
  }
}
