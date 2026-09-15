// Prompt quality against the real local model. Skipped unless RECALL_LIVE_LLM=1 (needs Ollama):
//   RECALL_LIVE_LLM=1 pnpm --filter @recall/mcp-server test extraction.live
import { OllamaProvider } from '@recall/llm';
import { describe, expect, it } from 'vitest';
import { ExtractionReply, normalise } from '../src/extraction/normalise.js';
import {
  EXTRACTION_SCHEMA,
  extractionMessages,
  JUDGE_SCHEMA,
  JudgeReply,
  judgeMessages,
} from '../src/extraction/prompt.js';

const live = process.env.RECALL_LIVE_LLM === '1';
const llm = new OllamaProvider(
  process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434',
  process.env.OLLAMA_MODEL ?? 'qwen3:8b',
);

describe.skipIf(!live)('prompts against the local model', () => {
  it('extracts scoped facts with calendar-correct expiry', async () => {
    const statement =
      "Remember I'm vegetarian now, and I'm in Boston for work until Wednesday so don't plan dinner for me. Our family prays together at 7pm.";
    const reply = await llm.chat({
      messages: extractionMessages({
        speaker: 'Emma',
        statement,
        timezone: 'America/New_York',
        now: new Date('2026-09-11T02:00:00Z'),
      }),
      jsonSchema: EXTRACTION_SCHEMA,
    });
    const { facts } = ExtractionReply.parse(JSON.parse(reply.text));
    const candidates = normalise(facts, { utterance: statement, role: 'owner', today: '2026-09-11' });

    expect(candidates.find((c) => /vegetarian/i.test(c.content))).toMatchObject({
      scope: 'person',
      confidence: 0.9,
      expiresOn: null,
    });
    expect(candidates.find((c) => /penang/i.test(c.content))).toMatchObject({
      scope: 'person',
      expiresOn: '2026-09-16',
    });
    expect(candidates.find((c) => /pray/i.test(c.content))).toMatchObject({ scope: 'household' });
  }, 60_000);

  it('tells restatements from updates', async () => {
    const judge = async (candidate: string, existing: string[]) =>
      JudgeReply.parse(
        JSON.parse((await llm.chat({ messages: judgeMessages(candidate, existing), jsonSchema: JUDGE_SCHEMA })).text),
      );

    expect(await judge('Emma is vegan', ['Emma is vegetarian'])).toEqual({ verdict: 'updates', match: 1 });
    expect(await judge('Emma is a vegetarian', ['Emma is vegetarian'])).toEqual({ verdict: 'same', match: 1 });
    expect(
      await judge('The household prays together at 7:30pm', [
        'Emma is vegetarian',
        'The household prays together at 7pm',
      ]),
    ).toEqual({ verdict: 'updates', match: 2 });
    expect((await judge('Emma likes jazz', ['Emma is vegetarian'])).verdict).toBe('new');
  }, 60_000);
});
