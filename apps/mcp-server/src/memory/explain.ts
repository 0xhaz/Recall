import type { FactSource, ScopeType } from '@recall/core';

// "What do you know about me?" as plain templating over stored facts: no model, so nothing
// can be added that isn't on record (design.md §3.3, the "no uncle" beat).

export interface ExplainFact {
  id: string;
  content: string;
  scope: ScopeType;
  confidence: number;
  source: FactSource;
  valid_from: string;
  expires_at: string | null;
}

export interface ExplainItem {
  id: string;
  content: string;
  source: string;
  since: string;
  certainty: 'you said so' | 'mentioned once' | 'not sure';
  until: string | null;
}

export interface Explanation {
  about: string | null;
  nothing_stored: boolean;
  yours: ExplainItem[];
  household: ExplainItem[];
  pending_statements: number;
  never_stored: string;
  spoken: string;
}

export const NEVER_STORED = 'I never keep card or account numbers, passwords, ID numbers or medical diagnoses.';
const SPOKEN_YOURS = 5;
const SPOKEN_HOUSEHOLD = 3;

export function sourceLabel(source: FactSource, speakerId: string | null): string {
  switch (source.origin) {
    case 'extraction':
    case 'user_statement':
      return source.speaker_id && source.speaker_id === speakerId ? 'you told me' : 'someone in the household told me';
    case 'caregiver':
      return 'entered by a caregiver';
    case 'seed':
      return 'added when the household was set up';
    default:
      return 'recorded';
  }
}

export function certaintyLabel(confidence: number): ExplainItem['certainty'] {
  if (confidence >= 0.85) return 'you said so';
  if (confidence >= 0.5) return 'mentioned once';
  return 'not sure';
}

export function buildExplanation(
  facts: ExplainFact[],
  ctx: { speakerId: string | null; about?: string | null; timezone: string; pending: number },
): Explanation {
  const day = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: ctx.timezone });
  const toItem = (f: ExplainFact): ExplainItem => ({
    id: f.id,
    content: f.content,
    source: sourceLabel(f.source, ctx.speakerId),
    since: day.format(new Date(f.valid_from)),
    certainty: certaintyLabel(f.confidence),
    until: f.expires_at ? day.format(new Date(f.expires_at)) : null,
  });
  const yours = facts.filter((f) => f.scope === 'person').map(toItem);
  const household = facts.filter((f) => f.scope !== 'person').map(toItem);
  const about = ctx.about?.trim() || null;
  const nothing = yours.length === 0 && household.length === 0;

  const say = (item: ExplainItem) =>
    `${item.content} (${item.source}, ${item.since}${item.until ? `, until ${item.until}` : ''})`;
  const parts: string[] = [];
  if (nothing && ctx.pending === 0) {
    parts.push(
      about
        ? `I don't have anything stored about ${about}.`
        : ctx.speakerId
          ? "I don't have anything stored about you yet."
          : "I don't have anything stored for this household yet.",
    );
  } else {
    parts.push(about ? `Here's what I have about ${about}.` : "Here's what I keep, and why.");
    if (yours.length) parts.push(`About you: ${yours.slice(0, SPOKEN_YOURS).map(say).join('; ')}.`);
    if (household.length) {
      parts.push(`For the whole household: ${household.slice(0, SPOKEN_HOUSEHOLD).map(say).join('; ')}.`);
    }
    const more = Math.max(0, yours.length - SPOKEN_YOURS) + Math.max(0, household.length - SPOKEN_HOUSEHOLD);
    if (more) parts.push(`There ${more === 1 ? 'is 1 more thing' : `are ${more} more things`} in the Recall app.`);
    if (ctx.pending) {
      parts.push(
        `I'm still processing ${ctx.pending === 1 ? 'one thing' : `${ctx.pending} things`} you said recently.`,
      );
    }
  }
  parts.push(NEVER_STORED);

  return {
    about,
    nothing_stored: nothing,
    yours,
    household,
    pending_statements: ctx.pending,
    never_stored: NEVER_STORED,
    spoken: parts.join(' '),
  };
}
