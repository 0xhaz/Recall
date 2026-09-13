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

/**
 * Kept as one block, in this order, because it is what measures best. Reordering it by priority read
 * better and cost tool calling outright: the beat still worked, but action_preflight stopped firing
 * on "order the usual" in 4 runs out of 4, where this version fires every time. What actually fixed
 * the answers was the digest — see below — not the wording here.
 */
export const SYSTEM_PROMPT = [
  'You are Alexa+, the voice assistant in this home. Recall is your memory, and the session brief below comes from it.',
  'Replies are spoken: one or two short sentences, plain words, no lists or markdown.',
  "Answer the new request directly, using the brief's facts. Never repeat the question back, never reuse an earlier",
  'reply (they_asked_earlier is only context), and only ask a question when you need the answer to go on.',
  "The facts are in order of what matters, and yours_first are the speaker's own: what they are like, what they",
  'can and cannot eat, what they prefer. Answer from those before any fact about the household, and never give an',
  'answer that contradicts one. If the speaker cannot eat something, do not suggest it to them.',
  'Answer what was actually asked. A question about what to cook, eat or do is a question: answer it from the facts',
  'about the people who are here, and do not turn it into an order or a booking.',
  'Stated rules override everything. Follow the style, and any repeat or care guidance, exactly.',
  "Only state what the brief or a tool result says; if they don't say, say you don't know.",
  'If the speaker is unknown, ask who is speaking before using or giving anything personal; if they ask about',
  '"me" or "my", reply only by asking who is speaking.',
  'To remember something, call remember. To forget something, call forget.',
  'Only when they actually ask for something to be done (ordering, booking, playing music, changing a device),',
  'call action_preflight',
  'with exactly what they said (venue, address, items), filling in from the facts only what they left out.',
  "Then: if it is blocked, say why, quoting the rule; if there are things to confirm, ask about them and wait; if it's",
  'allowed and they asked for it, call decide_action with "confirm".',
  'Never say something is done unless decide_action returned status "executed".',
  'For what is playing, timers or alarms, call device_state first.',
  'Never say a tool name out loud. Tool calls are how you act; what you say is only what the person hears.',
].join(' ');

/**
 * Planning prose is not speech. A small model often narrates the call it is about to make
 * ("decide_action with confirm to proceed") — spoken aloud that is gibberish, so it never becomes a
 * reply. Recognising it is cheap; the cost of getting it wrong is a demo that says a tool name.
 */
const TOOL_TALK =
  /\b(action_preflight|propose_action|decide_action|device_state|suggest_music|session_brief|verify_claim|explain_memory|set_rule|list_rules|remove_rule|set_context|get_context|ingest_events|checkin|set_reminder|confirm_reminder|set_care_policy|set_communication_style|remember|forget|undo|recall|sync)\b|^\s*(i (will|'ll|should|need to|am going to) (now )?call|calling|let me call|next,? call)/i;

export const isToolTalk = (s: string): boolean => TOOL_TALK.test(s.trim());

/**
 * Recall's tools as the model sees them: the plumbing removed, and otherwise exactly as the server
 * publishes them. Device-filled arguments are dropped when the call is made (see respond), so they
 * no longer have to be hidden here — and editing the schemas measurably hurt. Handed the trimmed
 * set, qwen3:8b answered "what should we cook tonight?" from the household takeaway in 5 runs out
 * of 5, ignoring the speaker's own dietary fact; handed them whole, it used that fact 5 times out
 * of 5. Same prompt, same brief, same model.
 */
export function modelTools(tools: readonly ToolInfo[]): ModelTool[] {
  return tools
    .filter((t) => !HIDDEN.has(t.name))
    .map((t) => ({
      type: 'function' as const,
      function: { name: t.name, description: t.description ?? '', parameters: t.inputSchema },
    }));
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
  facts?: { content: string; why?: string; scope?: string }[];
  active_session?: { recent_turns?: { role: string; text: string }[] };
  device_state?: { now_playing?: { title: string } | null };
  contexts?: { context: string; for: string }[];
  quiet_hours?: { active: boolean };
  repeat?: unknown;
  care?: unknown;
}

function keepRepeat(repeat: unknown, careMode: boolean): unknown {
  if (careMode || typeof repeat !== 'object' || repeat === null) return repeat;
  const { last_answer: _dropped, ...rest } = repeat as Record<string, unknown>;
  return rest;
}

const factText = (f: { content: string; why?: string }) =>
  f.why === 'pending_extraction' ? `${f.content} (just said)` : f.content;

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
    // Split by whose fact it is, not just ordered by it: a small model reading a flat list treats
    // "Aisyah is vegetarian" and "the usual takeaway is Warung Mak Teh" as equally good answers to
    // "what should we cook", and picks the one that sounds most like dinner.
    yours_first: b.facts?.filter((f) => f.scope === 'person').map(factText),
    about_the_home: b.facts?.filter((f) => f.scope !== 'person').map(factText),
    style: b.response_style,
    // What the people said, never what the assistant replied. Handed its own last reply, a small
    // model repeats it verbatim instead of answering: measured, two speakers with different facts
    // got the same sentence back, word for word, and the facts made no difference at all. If it
    // needs its own words, session_history is the tool that returns them.
    they_asked_earlier: b.active_session?.recent_turns
      ?.filter((t) => t.role === 'user')
      .slice(-3)
      .map((t) => t.text),
    // Deliberately not here: what is playing. device_state is the source for media, and the prompt
    // sends the model there when it is asked. Handed it unasked, a small model treats it as part of
    // the question — measured, "Morning news" in the digest was enough to lose a dietary fact
    // entirely (0/5 runs used it; 5/5 without).
    contexts: b.contexts?.map((c) => `${c.context} (${c.for})`),
    quiet_hours: b.quiet_hours?.active === true ? 'yes: answer briefly, offer nothing' : undefined,
    // Recall returns the previous answer so a cared-for person can be told the same thing the same
    // way, which is the point of care mode. For anyone else the guidance says the opposite — you
    // have nothing more to add, offer another way — yet a small model shown last_answer just copies
    // it, word for word, and the facts stop mattering. So it only travels when care mode is on.
    repeat: keepRepeat(b.repeat, b.care !== undefined),
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
      // The device knows who is speaking and where it is; the model never gets a say. Dropping what
      // it supplied is the guarantee — with an unknown speaker there is no context value to
      // overwrite a guess with, so anything it invented would otherwise survive.
      const given = Object.fromEntries(Object.entries(args).filter(([k]) => !DEVICE_FILLED.includes(k)));
      const filled = { ...given, ...Object.fromEntries(Object.entries(context).filter(([k]) => k in accepts)) };
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
        const said = clean(out.content);
        // Nothing left to do and nothing sayable: ask for the answer in words rather than speak
        // planning prose or fall through to an apology.
        if (said && !isToolTalk(said)) {
          reply = said;
          break;
        }
        messages.push({ role: 'assistant', content: out.content });
        messages.push({
          role: 'user',
          content: 'Say that to me in one or two short sentences, as speech. No tool names, no plans.',
        });
        continue;
      }
      // Content beside a tool call is the model thinking aloud: keep it for the model, never speak it.
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
