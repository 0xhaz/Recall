import { Inject, Injectable } from '@nestjs/common';
import { Db } from '../db/db.js';
import { buildExplanation, certaintyLabel, type ExplainFact, type Explanation, sourceLabel } from './explain.js';
import { type Household, MemoryService, type SearchHit, type Speaker } from './memory.service.js';

export interface Evidence {
  id: string;
  content: string;
  source: string;
  since: string;
  until: string | null;
  certainty: string;
  why: 'keyword' | 'semantic';
}

export interface Change {
  content: string;
  true_until: string;
  now: string | null;
}

/**
 * Evidence, not a verdict: embeddings rate "Alice eats meat" close to "Alice is vegetarian", so
 * similarity can't tell support from contradiction. The assistant compares the claim with what is
 * on record — and with no evidence, it must not assert the claim (design.md §3.2 #1).
 */
export interface Verification {
  status: 'evidence' | 'unknown';
  evidence: Evidence[];
  changed: Change[];
  message: string;
}

const isMatch = (h: SearchHit): h is SearchHit & { why: 'keyword' | 'semantic' } =>
  h.why === 'keyword' || h.why === 'semantic';

@Injectable()
export class ExplainService {
  constructor(
    @Inject(Db) private readonly db: Db,
    @Inject(MemoryService) private readonly memory: MemoryService,
  ) {}

  /** "What do you know about me?" — every current item visible to the speaker, with its source. */
  async explain(household: Household, speaker: Speaker | null, about?: string): Promise<Explanation> {
    const hits = about?.trim()
      ? (await this.memory.search(household.id, speaker, about, { limit: 20 })).filter((h) => h.why !== 'recent')
      : await this.memory.search(household.id, speaker, '', { limit: 40 });
    const facts: ExplainFact[] = hits
      .filter((h) => h.kind === 'fact')
      .map((h) => ({
        id: h.id,
        content: h.content,
        scope: h.scope,
        confidence: h.confidence,
        source: h.source,
        valid_from: h.valid_from,
        expires_at: h.expires_at,
      }));
    return buildExplanation(facts, {
      speakerId: speaker?.person_id ?? null,
      about,
      timezone: household.timezone,
      pending: hits.filter((h) => h.kind === 'utterance').length,
    });
  }

  async verify(household: Household, speaker: Speaker | null, claim: string): Promise<Verification> {
    const [current, closed] = await Promise.all([
      this.memory.search(household.id, speaker, claim, { limit: 3, mode: 'statement' }),
      this.memory.search(household.id, speaker, claim, { limit: 3, closed: true, mode: 'statement' }),
    ]);
    const evidence = current
      .filter((h) => h.kind === 'fact')
      .filter(isMatch)
      .map((h) => ({
        id: h.id,
        content: h.content,
        source: sourceLabel(h.source, speaker?.person_id ?? null),
        since: h.valid_from,
        until: h.expires_at,
        certainty: certaintyLabel(h.confidence),
        why: h.why,
      }));
    const history = closed.filter(isMatch);
    const successors = await this.successors(history.map((h) => h.superseded_by).filter((id): id is string => !!id));
    const changed = history.map((h) => ({
      content: h.content,
      true_until: h.valid_to ?? h.valid_from,
      now: (h.superseded_by && successors.get(h.superseded_by)) ?? null,
    }));

    if (evidence.length === 0 && changed.length === 0) {
      return {
        status: 'unknown',
        evidence,
        changed,
        message: "Nothing on record supports this. Don't assert it: say you don't know, or ask.",
      };
    }
    const parts = [
      'Compare the claim with this evidence. Assert it only if the evidence says the same thing, and give the source if asked.',
    ];
    if (changed.length) parts.push('Some of this has changed: say what is true now, and since when.');
    return { status: 'evidence', evidence, changed, message: parts.join(' ') };
  }

  private async successors(ids: string[]): Promise<Map<string, string>> {
    if (ids.length === 0) return new Map();
    const { rows } = await this.db.query<{ id: string; content: string }>(
      'SELECT id, content FROM fact WHERE id = ANY($1::uuid[]) AND forgotten_at IS NULL',
      [ids],
    );
    return new Map(rows.map((r) => [r.id, r.content]));
  }
}
