import { describe, expect, it } from 'vitest';
import {
  Agent,
  type AgentModel,
  digest,
  isToolTalk,
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

describe('isToolTalk', () => {
  it('catches a model narrating its own tool call, and leaves ordinary speech alone', () => {
    // The real failure: spoken aloud in the kitchen, this is gibberish.
    expect(isToolTalk('decide_action with "confirm" to proceed with the order.')).toBe(true);
    expect(isToolTalk("I'll call action_preflight first.")).toBe(true);
    expect(isToolTalk('Let me call device_state to check.')).toBe(true);

    expect(isToolTalk('There is rendang in the fridge, and you are vegetarian.')).toBe(false);
    expect(isToolTalk('Noted.')).toBe(false);
    expect(isToolTalk("I'll remind you on Wednesday.")).toBe(false);
  });
});

describe('Agent', () => {
  it('never speaks planning prose: it asks again for words, and says those instead', async () => {
    const recall = new FakeRecall();
    const model = new ScriptedModel([
      // No tool calls, but the "reply" is the model thinking aloud — exactly what reached the demo.
      { content: 'decide_action with "confirm" to proceed with the order.' },
      { content: 'Warung Mak Teh is the usual. Shall I order?' },
    ]);
    const reply = await new Agent(recall, model).respond({
      device: 'kitchen-echo',
      speaker: 'Aisyah',
      confidence: 0.95,
      text: 'What should we cook tonight?',
    });

    expect(reply.reply).toBe('Warung Mak Teh is the usual. Shall I order?');
    // It asked for speech rather than giving up or speaking the plan.
    const last = model.seen.at(-1)?.messages.at(-1);
    expect(last?.role).toBe('user');
    expect(last?.content).toContain('as speech');
  });

  it('keeps content that arrives beside a tool call for the model, and never speaks it', async () => {
    const recall = new FakeRecall();
    const model = new ScriptedModel([
      {
        content: 'First I will call remember to store this.',
        tool_calls: [{ function: { name: 'remember', arguments: { text: 'I am off coffee' } } }],
      },
      { content: 'Noted.' },
    ]);
    const reply = await new Agent(recall, model).respond({
      device: 'kitchen-echo',
      speaker: 'Aisyah',
      confidence: 0.95,
      text: 'Remember I am off coffee',
    });

    expect(reply.reply).toBe('Noted.');
    expect(reply.reply).not.toContain('remember');
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
          { content: 'Aisyah is vegetarian', why: 'semantic', scope: 'person' },
          { content: 'I am off coffee', why: 'pending_extraction', scope: 'person' },
          { content: 'The usual takeaway is Warung Mak Teh', why: 'semantic', scope: 'household' },
        ],
        contexts: [],
        quiet_hours: { active: false },
      }),
    ).toEqual({
      now: 'Monday 2026-10-05 19:02',
      speaker: 'not sure: maybe Aisyah; ask "Is this Aisyah?" first',
      rules: ['No music after 10pm on school nights'],
      // Split by whose fact it is: the speaker's own never sit in a flat list beside the house's.
      yours_first: ['Aisyah is vegetarian', 'I am off coffee (just said)'],
      about_the_home: ['The usual takeaway is Warung Mak Teh'],
    });
  });

  it("keeps the speaker's own facts separate even when only the household has any", () => {
    expect(
      digest({ facts: [{ content: 'Pizza night is on Fridays', why: 'semantic', scope: 'household' }] }),
    ).toMatchObject({ about_the_home: ['Pizza night is on Fridays'] });
  });
});
