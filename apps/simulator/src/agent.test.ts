import { describe, expect, it } from 'vitest';
import {
  Agent,
  type AgentModel,
  digest,
  type ModelMessage,
  type ModelTool,
  modelTools,
  type ToolCall,
} from './agent.js';
import type { RecallApi, ToolInfo } from './recall.js';

const schema = (props: string[], required: string[] = []) => ({
  type: 'object',
  properties: Object.fromEntries(props.map((p) => [p, { type: 'string' }])),
  required,
});

const TOOLS: ToolInfo[] = [
  { name: 'session_brief', inputSchema: schema(['speaker', 'speaker_confidence', 'device', 'hint']) },
  {
    name: 'remember',
    description: 'Remember',
    inputSchema: schema(['speaker', 'speaker_confidence', 'text'], ['text']),
  },
  { name: 'ingest_events', inputSchema: schema(['device', 'events'], ['device', 'events']) },
  { name: 'sync', inputSchema: schema(['device', 'cursor']) },
  { name: 'device_state', inputSchema: schema(['device']) },
];

class FakeRecall implements RecallApi {
  calls: { name: string; args: Record<string, unknown> }[] = [];
  async tools() {
    return TOOLS;
  }
  async call<T>(name: string, args: Record<string, unknown>): Promise<T> {
    this.calls.push({ name, args });
    const replies: Record<string, unknown> = {
      session_brief: { speaker: { id: 'p1', name: 'Aisyah', role: 'owner' }, ask_who_is_speaking: false },
      remember: { stored: true },
    };
    return (replies[name] ?? {}) as T;
  }
}

class ScriptedModel implements AgentModel {
  readonly model = 'scripted';
  seen: { messages: ModelMessage[]; tools: ModelTool[] }[] = [];
  constructor(private readonly turns: { content?: string; tool_calls?: ToolCall[] }[]) {}
  async chat(messages: ModelMessage[], tools: ModelTool[]) {
    this.seen.push({ messages: [...messages], tools });
    const next = this.turns.shift() ?? { content: 'Done.' };
    return { content: next.content ?? '', tool_calls: next.tool_calls ?? [] };
  }
}

describe('modelTools', () => {
  it('hides device plumbing and the parameters the device fills in', () => {
    const tools = modelTools(TOOLS);
    expect(tools.map((t) => t.function.name)).toEqual(['remember', 'device_state']);
    expect(tools[0]?.function.parameters).toMatchObject({
      properties: { text: { type: 'string' } },
      required: ['text'],
    });
    expect(Object.keys(tools[1]?.function.parameters.properties ?? {})).toEqual([]);
  });
});

describe('Agent', () => {
  it('starts from the brief, lets the model call tools with the speaker filled in, and returns the reply', async () => {
    const recall = new FakeRecall();
    const model = new ScriptedModel([
      { tool_calls: [{ function: { name: 'remember', arguments: { text: 'I am off coffee' } } }] },
      { content: 'Noted.' },
    ]);
    const reply = await new Agent(recall, model).respond({
      device: 'kitchen-echo',
      speaker: 'Aisyah',
      confidence: 0.95,
      text: 'Remember I am off coffee',
    });

    expect(reply).toMatchObject({ reply: 'Noted.', speaker: { name: 'Aisyah', role: 'owner' }, ask_who: false });
    expect(recall.calls).toEqual([
      {
        name: 'session_brief',
        args: { hint: 'Remember I am off coffee', speaker: 'Aisyah', speaker_confidence: 0.95, device: 'kitchen-echo' },
      },
      { name: 'remember', args: { text: 'I am off coffee', speaker: 'Aisyah', speaker_confidence: 0.95 } },
    ]);
    expect(model.seen[0]?.messages.map((m) => m.role)).toEqual(['system', 'user', 'assistant', 'tool']);
    expect(reply.steps.map((s) => s.tool)).toEqual(['session_brief', 'remember']);
  });

  it("refuses plumbing the model shouldn't reach, and never names an unknown speaker", async () => {
    const recall = new FakeRecall();
    const model = new ScriptedModel([
      { tool_calls: [{ function: { name: 'ingest_events', arguments: { events: [] } } }] },
      { content: '<think>hmm</think>Who is this?' },
    ]);
    const reply = await new Agent(recall, model).respond({
      device: 'bedroom-echo',
      speaker: null,
      confidence: 1,
      text: 'What do you know about me?',
    });
    expect(reply.reply).toBe('Who is this?');
    expect(recall.calls.map((c) => c.name)).toEqual(['session_brief']);
    expect(recall.calls[0]?.args).toEqual({ hint: 'What do you know about me?', device: 'bedroom-echo' });
  });
});

describe('digest', () => {
  it('keeps what the model needs, says plainly when the speaker is unknown, and drops the empty parts', () => {
    expect(
      digest({
        temporal: {
          local_date: '2026-10-05',
          local_time: '19:02:11',
          weekday: 'Monday',
          timezone: 'Asia/Kuala_Lumpur',
        },
        speaker: null,
        speaker_candidate: 'Aisyah',
        rules: [{ text: 'No music after 10pm on school nights' }],
        facts: [
          { content: 'Aisyah is vegetarian', why: 'semantic' },
          { content: 'I am off coffee', why: 'pending_extraction' },
        ],
        contexts: [],
        quiet_hours: { active: false },
      }),
    ).toEqual({
      now: 'Monday 2026-10-05 19:02',
      speaker: 'not sure: maybe Aisyah; ask "Is this Aisyah?" first',
      rules: ['No music after 10pm on school nights'],
      facts: ['Aisyah is vegetarian', 'I am off coffee (just said)'],
    });
  });
});
