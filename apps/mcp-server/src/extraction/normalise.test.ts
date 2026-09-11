import { describe, expect, it } from 'vitest';
import { type Draft, FIRM_CONFIDENCE, MENTION_CONFIDENCE, normalise } from './normalise.js';

const draft = (content: string, extra: Partial<Draft> = {}): Draft => ({
  content,
  type: 'semantic',
  scope: 'person',
  firm: true,
  ends: null,
  ...extra,
});

const ctx = {
  utterance: 'Our family prays together at 7pm, and I like jazz',
  role: 'owner' as const,
  today: '2026-09-11', // a Friday
};

describe('normalise', () => {
  it('only keeps household scope when both the fact and the statement are collective', () => {
    const [prays, jazz] = normalise(
      [
        draft('The household prays together at 7pm', { scope: 'household' }),
        draft('Alice likes jazz', { scope: 'household' }),
      ],
      ctx,
    );
    expect(prays?.scope).toBe('household');
    expect(jazz?.scope).toBe('person');

    const [solo] = normalise([draft('The household likes jazz', { scope: 'household' })], {
      ...ctx,
      utterance: 'I like jazz',
    });
    expect(solo?.scope).toBe('person');
  });

  it('maps firmness to calibrated confidence', () => {
    const [firm, passing] = normalise(
      [draft('Alice is vegetarian'), draft('Alice liked a jazz playlist', { firm: false })],
      ctx,
    );
    expect(firm?.confidence).toBe(FIRM_CONFIDENCE);
    expect(passing?.confidence).toBe(MENTION_CONFIDENCE);
  });

  it('drops anything the screen would block, even if the model wrote it', () => {
    expect(normalise([draft("Alice's card number is 4111 1111 1111 1111")], ctx)).toEqual([]);
    expect(normalise([draft("Alice's brother was diagnosed with diabetes")], ctx)).toEqual([]);
  });

  it('drops duplicates within one reply and trims trailing periods', () => {
    const facts = normalise([draft('Alice is vegetarian.'), draft('alice is vegetarian')], ctx);
    expect(facts.map((f) => f.content)).toEqual(['Alice is vegetarian']);
  });

  it("turns the speaker's end words into dates, and never keeps a temporary fact forever", () => {
    const expiries = normalise(
      [
        draft('Alice is in Penang', { ends: 'until Wednesday' }),
        draft('Alice is off sugar', { ends: 'for a while' }),
        draft('Alice was in Ipoh', { ends: '2026-09-01' }),
        draft('Alice is vegetarian', { ends: 'null' }),
      ],
      ctx,
    ).map((f) => f.expiresOn);
    expect(expiries).toEqual(['2026-09-16', '2026-09-18', null, null]);
  });

  it('tags health content and keeps it', () => {
    const [allergy] = normalise([draft('Alice is allergic to shellfish')], ctx);
    expect(allergy?.sensitivity).toBe('health');
  });

  it("gives a child's facts the child tag and a 30-day expiry", () => {
    const [fact] = normalise([draft('Kid likes dinosaurs')], { ...ctx, role: 'child' });
    expect(fact).toMatchObject({ sensitivity: 'child', expiresOn: '2026-10-11' });
  });
});
