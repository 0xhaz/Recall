// Stated rules end to end: saved verbatim, applied in session_brief, conflicts surfaced,
// permissions and safety severity, removal by the right person, and sync to devices.
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import {
  addDays,
  MemoryProjection,
  type ProjectionState,
  resolveEnd,
  type SyncEvent,
  temporalStamp,
} from '@recall/core';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { ParsedRule } from '../src/rules/parse.js';
import { ScriptedLlm } from './fakes.js';
import { callTool, startApp, type TestApp, type TestHousehold } from './support.js';

type SyncResponse =
  | { mode: 'replay'; events: SyncEvent[]; next_cursor: number; has_more: boolean }
  | { mode: 'snapshot'; snapshot: ProjectionState; next_cursor: number; has_more: boolean };

interface Rule {
  id: string;
  text: string;
  summary: string;
  applies_to: string;
  author: string | null;
  severity: string;
  expires_at: string | null;
}

interface SetRuleResponse {
  saved: boolean;
  rule?: Rule;
  conflicts?: Rule[];
  refused?: string;
  message: string;
}

const parses: ParsedRule[] = [];
const llm = new ScriptedLlm(() => parses.shift() ?? parsed({ intents: [] }));

function parsed(extra: Partial<ParsedRule> = {}): ParsedRule {
  return {
    effect: 'block',
    intents: ['media.play'],
    topics: [],
    time_from: null,
    time_to: null,
    days: null,
    school_nights: false,
    applies_to: 'household',
    ends: null,
    ...extra,
  };
}

let t: TestApp;
let hh: TestHousehold;
let client: Client;

const setRule = (args: Record<string, unknown>) => callTool<SetRuleResponse>(client, 'set_rule', args);
const listRules = async (speaker: string) =>
  (await callTool<{ rules: Rule[] }>(client, 'list_rules', { speaker })).rules;

async function syncRules(): Promise<string[]> {
  let projection = new MemoryProjection();
  for (let page = 0; page < 50; page++) {
    const res = await callTool<SyncResponse>(client, 'sync', { device: 'kitchen-echo', cursor: projection.cursor });
    if (res.mode === 'snapshot') projection = new MemoryProjection(res.snapshot);
    else projection.applyAll(res.events);
    if (!res.has_more) break;
  }
  return projection.currentRules().map((r) => r.text);
}

beforeAll(async () => {
  t = await startApp({ llm });
  hh = await t.createHousehold([
    ['Aisyah', 'owner'],
    ['Daniel', 'adult'],
    ['Kid', 'child'],
    ['Som', 'cared_for'],
    ['Farah', 'caregiver'],
    ['Gus', 'guest'],
  ]);
  client = await t.mcp(hh.token);
});

beforeEach(() => {
  parses.length = 0;
});

afterAll(() => t?.close());

describe('set_rule', () => {
  it('saves a household rule word for word, applies it to everyone, and syncs it', async () => {
    parses.push(parsed({ time_from: '22:00', time_to: '06:00', school_nights: true }));
    const result = await setRule({ speaker: 'Aisyah', text: 'No music after 10pm on school nights' });
    expect(result).toMatchObject({
      saved: true,
      conflicts: [],
      rule: {
        text: 'No music after 10pm on school nights',
        applies_to: 'household',
        author: 'Aisyah',
        summary: 'Block playing music or media 22:00–06:00 on school nights — household',
      },
    });

    expect((await listRules('Daniel')).map((r) => r.text)).toEqual(['No music after 10pm on school nights']);
    const brief = await callTool<{ rules: Rule[] }>(client, 'session_brief', { speaker: 'Daniel' });
    expect(brief.rules.map((r) => r.text)).toEqual(['No music after 10pm on school nights']);
    expect(await syncRules()).toEqual(['No music after 10pm on school nights']);
  });

  it('reports a conflict instead of resolving it', async () => {
    parses.push(parsed({ effect: 'prefer', applies_to: 'me' }));
    const result = await setRule({ speaker: 'Daniel', text: 'Always play music when I work out' });
    expect(result.saved).toBe(true);
    expect(result.conflicts?.map((c) => c.text)).toEqual(['No music after 10pm on school nights']);
    expect(result.message).toContain('nothing was changed');
  });

  it("reads the speaker's end words as an expiry", async () => {
    parses.push(
      parsed({ effect: 'require_confirm', intents: ['order.food', 'purchase'], applies_to: 'me', ends: 'this month' }),
    );
    const result = await setRule({ speaker: 'Daniel', text: 'Ask me before ordering anything this month' });
    const lastDay = resolveEnd('this month', temporalStamp('Asia/Kuala_Lumpur').local_date) ?? '';
    expect(Date.parse(result.rule?.expires_at ?? '')).toBe(Date.parse(`${addDays(lastDay, 1)}T00:00:00+08:00`));
  });

  it('takes a structured rule from the console without asking the model', async () => {
    const calls = llm.calls.length;
    const result = await setRule({
      speaker: 'Aisyah',
      text: 'No calls after 9pm',
      structured: parsed({ intents: ['call'], time_from: '21:00', time_to: '07:00' }),
    });
    expect(result.saved).toBe(true);
    expect(llm.calls.length).toBe(calls);
  });

  it('only lets the right people set rules, and for the right people', async () => {
    parses.push(parsed({ applies_to: 'Aisyah' }));
    expect((await setRule({ speaker: 'Daniel', text: 'No music for Aisyah' })).refused).toBe('not_allowed');
    parses.push(parsed());
    expect((await setRule({ speaker: 'Kid', text: 'No music at all' })).refused).toBe('not_allowed');
    parses.push(parsed({ applies_to: 'Kid', time_from: '20:00', time_to: '06:00' }));
    expect((await setRule({ speaker: 'Aisyah', text: 'No videos after 8pm for Kid' })).rule?.applies_to).toBe(
      'for Kid',
    );
    expect((await setRule({ speaker: 'Gus', text: 'No rules for me' })).refused).toBe('not_allowed');
    expect((await setRule({ text: 'No music' })).refused).toBe('unknown_speaker');
    parses.push(parsed({ applies_to: 'Zed' }));
    expect((await setRule({ speaker: 'Aisyah', text: 'No music for Zed' })).refused).toBe('unknown_target');
    parses.push(parsed({ intents: ['vibes'] }));
    expect((await setRule({ speaker: 'Aisyah', text: 'Keep the vibes right' })).refused).toBe('unclear');
  });

  it('saves safety rules only from a caregiver, for the person they care for', async () => {
    parses.push(parsed({ intents: ['smart_home'], topics: ['stove'], applies_to: 'Som' }));
    const stove = await setRule({ speaker: 'Farah', text: 'Never turn on the stove for Som', severity: 'safety' });
    expect(stove.rule?.severity).toBe('safety');

    parses.push(parsed({ intents: ['smart_home'], topics: ['door'], applies_to: 'me' }));
    const door = await setRule({ speaker: 'Daniel', text: 'Never unlock the front door at night', severity: 'safety' });
    expect(door.rule?.severity).toBe('hard');
    expect(door.message).toContain('Only a caregiver can make a safety rule');
  });
});

describe('remove_rule', () => {
  it('lets only the author (or a caregiver) remove a rule, and devices drop it', async () => {
    const quiet = (await listRules('Aisyah')).find((r) => r.text.startsWith('No music after 10pm'));
    expect(
      (await callTool<{ refused: string }>(client, 'remove_rule', { speaker: 'Daniel', rule_id: quiet?.id })).refused,
    ).toBe('not_allowed');
    const removed = await callTool<{ removed: boolean }>(client, 'remove_rule', {
      speaker: 'Aisyah',
      rule_id: quiet?.id,
    });
    expect(removed.removed).toBe(true);
    expect((await listRules('Aisyah')).map((r) => r.text)).not.toContain('No music after 10pm on school nights');
    expect(await syncRules()).not.toContain('No music after 10pm on school nights');

    parses.push(parsed({ intents: ['notification'], applies_to: 'me' }));
    const own = await setRule({ speaker: 'Som', text: 'No news in the morning' });
    const byCaregiver = await callTool<{ removed: boolean }>(client, 'remove_rule', {
      speaker: 'Farah',
      rule_id: own.rule?.id,
    });
    expect(byCaregiver.removed).toBe(true);
  });
});
