import { describe, expect, it } from 'vitest';
import {
  Agent,
  type AgentModel,
  clean,
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
      session_brief: { speaker: { id: 'p1', name: 'Emma', role: 'owner' }, ask_who_is_speaking: false },
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
  it('hides the plumbing and passes the remaining schemas through untouched', () => {
    const tools = modelTools(TOOLS);
    expect(tools.map((t) => t.function.name)).toEqual(['remember', 'device_state']);
    // Exactly as published: editing these measurably cost the model the speaker's own facts.
    expect(tools[0]?.function.parameters).toEqual(TOOLS.find((t) => t.name === 'remember')?.inputSchema);
    expect(tools[1]?.function.parameters).toEqual(TOOLS.find((t) => t.name === 'device_state')?.inputSchema);
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
      speaker: 'Emma',
      confidence: 0.95,
      text: 'Remember I am off coffee',
    });

    expect(reply).toMatchObject({ reply: 'Noted.', speaker: { name: 'Emma', role: 'owner' }, ask_who: false });
    expect(recall.calls).toEqual([
      {
        name: 'session_brief',
        args: { hint: 'Remember I am off coffee', speaker: 'Emma', speaker_confidence: 0.95, device: 'kitchen-echo' },
      },
      { name: 'remember', args: { text: 'I am off coffee', speaker: 'Emma', speaker_confidence: 0.95 } },
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

describe('Agent', () => {
  it('drops a speaker the model invented, even when the device does not know who is talking', () => {
    const recall = new FakeRecall();
    const model = new ScriptedModel([
      // The schemas now show these fields, so the model may well try to fill them in.
      {
        tool_calls: [
          { function: { name: 'remember', arguments: { text: 'x', speaker: 'Emma', speaker_confidence: 1 } } },
        ],
      },
      { content: 'Who is this?' },
    ]);
    return new Agent(recall, model)
      .respond({ device: 'bedroom-echo', speaker: null, confidence: 1, text: 'remember something' })
      .then(() => {
        const call = recall.calls.find((c) => c.name === 'remember');
        expect(call?.args).toEqual({ text: 'x', device: undefined });
        expect(call?.args).not.toHaveProperty('speaker');
      });
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
      { content: 'Napoli Pizza is the usual. Shall I order?' },
    ]);
    const reply = await new Agent(recall, model).respond({
      device: 'kitchen-echo',
      speaker: 'Emma',
      confidence: 0.95,
      text: 'What should we cook tonight?',
    });

    expect(reply.reply).toBe('Napoli Pizza is the usual. Shall I order?');
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
      speaker: 'Emma',
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
          timezone: 'America/New_York',
        },
        speaker: null,
        speaker_candidate: 'Emma',
        rules: [{ text: 'No music after 10pm on school nights' }],
        facts: [
          { content: 'Emma is vegetarian', why: 'semantic', scope: 'person' },
          { content: 'I am off coffee', why: 'pending_extraction', scope: 'person' },
          { content: 'The usual takeaway is Napoli Pizza', why: 'semantic', scope: 'household' },
        ],
        contexts: [],
        quiet_hours: { active: false },
      }),
    ).toEqual({
      now: 'Monday 2026-10-05 19:02',
      speaker: 'not sure: maybe Emma; ask "Is this Emma?" first',
      rules: ['No music after 10pm on school nights'],
      // Split by whose fact it is: the speaker's own never sit in a flat list beside the house's.
      yours_first: ['Emma is vegetarian', 'I am off coffee (just said)'],
      about_the_home: ['The usual takeaway is Napoli Pizza'],
    });
  });

  it("keeps the speaker's own facts separate even when only the household has any", () => {
    expect(
      digest({ facts: [{ content: 'Pizza night is on Fridays', why: 'semantic', scope: 'household' }] }),
    ).toMatchObject({ about_the_home: ['Pizza night is on Fridays'] });
  });

  it('hands back the previous answer in care mode, and never outside it', () => {
    const repeat = {
      asked_before: 2,
      last_answer: 'Nina is coming at three.',
      looping: true,
      guidance: 'Answer again, warmly.',
    };
    // Care mode: saying the same thing the same way is the point — a repeated question gets the
    // same warm answer, never "I already told you".
    expect(digest({ repeat, care: { rules: [] } })).toMatchObject({ repeat });
    // Anyone else: the guidance says there is nothing more to add, but a small model shown the old
    // answer simply repeats it, so it never sees it.
    const normal = digest({ repeat }) as { repeat: Record<string, unknown> };
    expect(normal.repeat).toMatchObject({ asked_before: 2, looping: true });
    expect(normal.repeat).not.toHaveProperty('last_answer');
  });

  it('feeds back what the people said, never what the assistant replied', () => {
    // Handed its own last reply, a small model repeats it verbatim instead of answering — the
    // facts stop mattering entirely. It can call session_history if it needs its own words.
    const out = digest({
      active_session: {
        recent_turns: [
          { role: 'user', text: 'What should we cook tonight?' },
          { role: 'assistant', text: 'The usual takeaway is Napoli Pizza. Would you like to order?' },
          { role: 'user', text: 'something lighter' },
        ],
      },
    });
    expect(out).toMatchObject({ they_asked_earlier: ['What should we cook tonight?', 'something lighter'] });
    expect(JSON.stringify(out)).not.toContain('Napoli Pizza');
  });
});

describe('clean', () => {
  it('strips the reasoning each model shows, and keeps the reply', () => {
    // Nova puts its reasoning in <thinking> and the answer after it.
    expect(clean('<thinking>She is vegetarian.</thinking>\nHow about a vegetarian dish?')).toBe(
      'How about a vegetarian dish?',
    );
    // qwen uses <think>.
    expect(clean('<think>hmm</think>Noted.')).toBe('Noted.');
    expect(clean('Nothing to strip.')).toBe('Nothing to strip.');
  });

  it('drops a tag left open, because the rest is reasoning cut off mid-thought', () => {
    expect(clean('<thinking>I should check whether')).toBe('');
    expect(clean('Here you go.<think>wait, no')).toBe('Here you go.');
  });
});
