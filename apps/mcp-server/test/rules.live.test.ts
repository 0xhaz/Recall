// The rule parser against the real local model. Skipped unless RECALL_LIVE_LLM=1 (needs Ollama):
//   RECALL_LIVE_LLM=1 pnpm --filter @recall/mcp-server exec vitest run rules.live
import { OllamaProvider } from '@recall/llm';
import { describe, expect, it } from 'vitest';
import { ParsedRule, RULE_SCHEMA, ruleMessages, structureRule } from '../src/rules/parse.js';

const live = process.env.RECALL_LIVE_LLM === '1';
const llm = new OllamaProvider(
  process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434',
  process.env.OLLAMA_MODEL ?? 'qwen3:8b',
);

async function parse(speaker: string, text: string) {
  const reply = await llm.chat({
    messages: ruleMessages({ speaker, text, timezone: 'America/New_York', now: new Date('2026-09-11T02:00:00Z') }),
    jsonSchema: RULE_SCHEMA,
  });
  return structureRule(ParsedRule.parse(JSON.parse(reply.text)));
}

describe.skipIf(!live)('rule parser against the local model', () => {
  it('reads a household quiet-hours rule', async () => {
    expect(await parse('Emma', 'No music after 10pm on school nights')).toMatchObject({
      effect: 'block',
      subject: { intents: ['media.play'] },
      condition: { time_from: '22:00', time_to: '06:00', school_nights: true },
      applies_to: 'household',
    });
  }, 60_000);

  it('reads an ask-first rule for the speaker', async () => {
    const rule = await parse('Daniel', 'Always ask me before you order food');
    expect(rule).toMatchObject({ effect: 'require_confirm', applies_to: 'me' });
    expect('subject' in rule && rule.subject.intents).toContain('order.food');
  }, 60_000);

  it('reads a topic rule for someone else', async () => {
    const rule = await parse('Emma', "Don't suggest anything with prawns for Sofia");
    expect(rule).toMatchObject({ applies_to: 'Sofia' });
    expect('subject' in rule && rule.subject.topics.join(' ')).toContain('prawn');
  }, 60_000);

  it('keeps the end in words for the calendar to resolve', async () => {
    const rule = await parse('Daniel', 'Keep the bedroom lights off after 11pm until Sunday');
    expect(rule).toMatchObject({ subject: { intents: ['smart_home'] }, condition: { time_from: '23:00' } });
    expect('ends' in rule && rule.ends?.toLowerCase()).toContain('sunday');
  }, 60_000);
});
