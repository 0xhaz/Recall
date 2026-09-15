import { describe, expect, it } from 'vitest';
import { buildExplanation, type ExplainFact, NEVER_STORED } from './explain.js';

const fact = (content: string, extra: Partial<ExplainFact> = {}): ExplainFact => ({
  id: content,
  content,
  scope: 'person',
  confidence: 0.9,
  source: { origin: 'extraction', speaker_id: 'alice' },
  valid_from: '2026-09-11T15:00:00Z',
  expires_at: null,
  ...extra,
});

const ctx = { speakerId: 'alice', timezone: 'America/New_York', pending: 0 };

describe('buildExplanation', () => {
  it('says plainly when nothing is stored about the subject', () => {
    const result = buildExplanation([], { ...ctx, about: 'my uncle' });
    expect(result.nothing_stored).toBe(true);
    expect(result.spoken).toBe(`I don't have anything stored about my uncle. ${NEVER_STORED}`);
  });

  it('labels where each fact came from and how sure it is', () => {
    const result = buildExplanation(
      [
        fact('Emma is vegetarian'),
        fact('Emma liked a jazz playlist', { confidence: 0.5 }),
        fact('Ruth takes her tea with condensed milk', {
          source: { origin: 'caregiver' },
          expires_at: '2026-09-17T03:59:59Z',
        }),
        fact('Family dinner is at 19:30', { scope: 'household', source: { origin: 'seed' } }),
      ],
      ctx,
    );
    expect(result.yours.map((i) => [i.source, i.certainty, i.until])).toEqual([
      ['you told me', 'you said so', null],
      ['you told me', 'mentioned once', null],
      ['entered by a caregiver', 'you said so', '16 Sept'],
    ]);
    expect(result.household[0]?.source).toBe('added when the household was set up');
    expect(result.spoken).toContain('About you: Emma is vegetarian (you told me, 11 Sept)');
    expect(result.spoken).toContain('For the whole household: Family dinner is at 19:30');
    expect(result.spoken.endsWith(NEVER_STORED)).toBe(true);
  });

  it("keeps speech short and counts what it didn't read out", () => {
    const many = Array.from({ length: 8 }, (_, i) => fact(`Fact ${i}`));
    const result = buildExplanation(many, { ...ctx, pending: 2 });
    expect(result.spoken).toContain('There are 3 more things in the Recall app.');
    expect(result.spoken).toContain("I'm still processing 2 things you said recently.");
  });

  it('tells a household member apart from the person the fact is about', () => {
    const [item] = buildExplanation(
      [fact('Daniel likes spicy food', { source: { origin: 'extraction', speaker_id: 'daniel' } })],
      ctx,
    ).yours;
    expect(item?.source).toBe('someone in the household told me');
  });
});
