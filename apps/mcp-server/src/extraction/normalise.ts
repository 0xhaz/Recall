import {
  addDays,
  type FactType,
  isIsoDate,
  type MembershipRole,
  resolveEnd,
  type SensitivityTag,
  screen,
} from '@recall/core';
import * as z from 'zod';

export const Draft = z.object({
  content: z.string(),
  type: z.enum(['semantic', 'episodic', 'procedural']),
  scope: z.enum(['person', 'household']),
  firm: z.boolean(),
  /** The speaker's words for when it ends ("Wednesday", "this week"), resolved by resolveEnd(). */
  ends: z.string().nullable(),
});
export type Draft = z.infer<typeof Draft>;

export const ExtractionReply = z.object({ facts: z.array(Draft) });

export interface Candidate {
  content: string;
  type: FactType;
  scope: 'person' | 'household';
  confidence: number;
  sensitivity: SensitivityTag;
  /** Last local date the fact is true; null for durable facts. */
  expiresOn: string | null;
}

/** A firm statement is trusted; a passing mention is "mentioned once" (calibrated claims, architecture.md §1.2). */
export const FIRM_CONFIDENCE = 0.9;
export const MENTION_CONFIDENCE = 0.5;
/** Facts from a child's own speech expire unless a parent enters them (minimal retention, COPPA posture). */
export const CHILD_RETENTION_DAYS = 30;
/** A temporary situation whose end we can't parse is kept for a week, not forever. */
export const VAGUE_END_DAYS = 7;

const COLLECTIVE = /\b(we|our|ours|us|family|household|everyone)\b/i;
const NO_END = /^(null|none|never|n\/a)$/i;
const TAG_PRIORITY: readonly SensitivityTag[] = ['child', 'health', 'financial', 'third_party', 'pii'];

export interface NormaliseContext {
  /** The screened statement the drafts came from. */
  utterance: string;
  role: MembershipRole;
  /** Household-local YYYY-MM-DD. */
  today: string;
}

function expiryFor(ends: string | null, today: string): string | null {
  const phrase = ends?.trim();
  if (!phrase || NO_END.test(phrase)) return null;
  const resolved = resolveEnd(phrase, today);
  if (resolved) return resolved;
  // A past date means the episode is over and stays true as history; anything else is just vague.
  return isIsoDate(phrase) ? null : addDays(today, VAGUE_END_DAYS);
}

/**
 * Deterministic rules over the model's drafts. The model proposes; this decides scope,
 * confidence, sensitivity and expiry, and can only make a fact more private, never less.
 */
export function normalise(drafts: readonly Draft[], ctx: NormaliseContext): Candidate[] {
  const seen = new Set<string>();
  const candidates: Candidate[] = [];

  for (const draft of drafts) {
    const content = draft.content.trim().replace(/\.+$/, '');
    const key = content.toLowerCase();
    if (!content || seen.has(key)) continue;

    // The model must never reintroduce what the write-time screen removed.
    const screened = screen(content);
    if (screened.redactions.length > 0) continue;
    seen.add(key);

    // Household scope shows a fact to everyone, so both the fact and what was said must be collective.
    const scope =
      draft.scope === 'household' && COLLECTIVE.test(content) && COLLECTIVE.test(ctx.utterance)
        ? 'household'
        : 'person';

    const tags = new Set(screened.tags);
    if (ctx.role === 'child') tags.add('child');

    let expiresOn = expiryFor(draft.ends, ctx.today);
    if (ctx.role === 'child') {
      const cap = addDays(ctx.today, CHILD_RETENTION_DAYS);
      if (!expiresOn || expiresOn > cap) expiresOn = cap;
    }

    candidates.push({
      content,
      type: draft.type,
      scope,
      confidence: draft.firm ? FIRM_CONFIDENCE : MENTION_CONFIDENCE,
      sensitivity: TAG_PRIORITY.find((t) => tags.has(t)) ?? 'none',
      expiresOn,
    });
  }
  return candidates;
}
