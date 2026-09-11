import { Inject, Injectable } from '@nestjs/common';
import type { FactSource, FactType, MembershipRole, ScopeType, SensitivityTag } from '@recall/core';
import { Db } from '../db/db.js';

export interface Household {
  id: string;
  name: string;
  region: string;
  timezone: string;
}

export interface Speaker {
  person_id: string;
  display_name: string;
  role: MembershipRole;
  confidence: number;
}

export interface RecalledFact {
  id: string;
  content: string;
  scope: ScopeType;
  type: FactType;
  confidence: number;
  sensitivity: SensitivityTag;
  source: FactSource;
  valid_from: string;
  /** Why this fact was returned — keyword match, or filler from the speaker's most relevant recent facts. */
  why: 'keyword' | 'recent';
}

export type RememberResult =
  | { stored: true; fact_id: string; scope: 'person' | 'household'; extraction: 'pending' }
  | { stored: false; reason: 'unknown_speaker' | 'guest_mode'; message: string };

interface FactRow {
  id: string;
  content: string;
  scope_type: ScopeType;
  type: FactType;
  confidence: number;
  sensitivity_tag: SensitivityTag;
  source: FactSource;
  valid_from: Date;
  rank: number;
}

/**
 * Week-1 memory core: scoped storage and keyword recall over Postgres.
 * Extraction, pgvector fusion and supersession arrive in weeks 2–3 (workplan WS3).
 */
@Injectable()
export class MemoryService {
  constructor(@Inject(Db) private readonly db: Db) {}

  async household(householdId: string): Promise<Household | null> {
    const { rows } = await this.db.query<Household>('SELECT id, name, region, timezone FROM household WHERE id = $1', [
      householdId,
    ]);
    return rows[0] ?? null;
  }

  /**
   * Match an explicit speaker (person id or display name) against active memberships.
   * Unknown or ambiguous → null: callers fall back to household scope and ask. Never guess.
   */
  async resolveSpeaker(householdId: string, speaker: string | undefined): Promise<Speaker | null> {
    const hint = speaker?.trim();
    if (!hint) return null;
    const { rows } = await this.db.query<Omit<Speaker, 'confidence'>>(
      `SELECT p.id AS person_id, p.display_name, m.role
         FROM membership m JOIN person p ON p.id = m.person_id
        WHERE m.household_id = $1 AND m.revoked_at IS NULL
          AND (p.id::text = $2 OR lower(p.display_name) = lower($2))
        LIMIT 2`,
      [householdId, hint],
    );
    const [match] = rows;
    if (!match || rows.length > 1) return null;
    // The client named the speaker explicitly; resolve_speaker (week 3) will supply real confidence.
    return { ...match, confidence: 1 };
  }

  async remember(
    householdId: string,
    speaker: Speaker | null,
    text: string,
    scope: 'person' | 'household',
  ): Promise<RememberResult> {
    if (!speaker) {
      return {
        stored: false,
        reason: 'unknown_speaker',
        message: 'Not stored: I do not know who is speaking. Ask who it is, then call remember again.',
      };
    }
    if (speaker.role === 'guest') {
      return { stored: false, reason: 'guest_mode', message: 'Not stored: guests are in ephemeral mode.' };
    }

    const source: FactSource = {
      speaker_id: speaker.person_id,
      speaker_confidence: speaker.confidence,
      origin: 'user_statement',
    };
    // Stored verbatim as an episodic record of what was said. The week-2 extractor derives
    // semantic facts from it; one mention stays low confidence (calibrated claims, architecture.md §1.2).
    const { rows } = await this.db.query<{ id: string }>(
      `INSERT INTO fact (household_id, region, scope_type, scope_id, type, content, source, confidence)
       SELECT h.id, h.region, $2, $3, 'episodic', $4, $5, 0.6 FROM household h WHERE h.id = $1
       RETURNING id`,
      [householdId, scope, scope === 'person' ? speaker.person_id : householdId, text, JSON.stringify(source)],
    );
    const row = rows[0];
    if (!row) throw new Error(`Household ${householdId} not found`);
    return { stored: true, fact_id: row.id, scope, extraction: 'pending' };
  }

  /**
   * Current facts visible to the speaker: their own person facts plus household facts.
   * With no resolved speaker, household facts only (architecture.md §1.3).
   */
  async recall(householdId: string, speaker: Speaker | null, query: string, limit: number): Promise<RecalledFact[]> {
    const { rows } = await this.db.query<FactRow>(
      `WITH q AS (SELECT CASE WHEN $3 = '' THEN NULL ELSE to_tsquery('english', $3) END AS tsq)
       SELECT f.id, f.content, f.scope_type, f.type, f.confidence, f.sensitivity_tag, f.source, f.valid_from,
              CASE WHEN q.tsq IS NOT NULL AND f.content_tsv @@ q.tsq THEN ts_rank(f.content_tsv, q.tsq) ELSE 0 END AS rank
         FROM fact f, q
        WHERE f.household_id = $1
          AND f.valid_to IS NULL
          AND (f.ttl IS NULL OR f.valid_from + f.ttl > now())
          AND (f.scope_type = 'household' OR (f.scope_type = 'person' AND f.scope_id = $2::uuid))
        ORDER BY rank DESC, f.confidence DESC, f.created_at DESC
        LIMIT $4`,
      [householdId, speaker?.person_id ?? null, toTsQuery(query), limit],
    );
    return rows.map((r) => ({
      id: r.id,
      content: r.content,
      scope: r.scope_type,
      type: r.type,
      confidence: r.confidence,
      sensitivity: r.sensitivity_tag,
      source: r.source,
      valid_from: r.valid_from.toISOString(),
      why: r.rank > 0 ? 'keyword' : 'recent',
    }));
  }
}

/** OR together prefix terms. Only letters and digits survive, so user text can't inject tsquery syntax. */
export function toTsQuery(query: string): string {
  const words = new Set((query.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter((w) => w.length > 2));
  return [...words].map((w) => `${w}:*`).join(' | ');
}
