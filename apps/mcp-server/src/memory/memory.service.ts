import { Inject, Injectable } from '@nestjs/common';
import {
  type BlockedCategory,
  type FactSource,
  type FactType,
  type MembershipRole,
  type ScopeType,
  type SensitivityTag,
  screen,
  tagsFor,
} from '@recall/core';
import { APP_CONFIG, type AppConfig } from '../config.js';
import { Db } from '../db/db.js';
import { enqueue } from '../jobs/queue.js';

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

export interface Identity {
  /** Trusted speaker, or null: then only household facts are used. */
  speaker: Speaker | null;
  /** A matching name below the confidence threshold, so the assistant can ask "is this Aisyah?". */
  candidate: string | null;
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
  /** keyword match, filler from the most relevant recent facts, or a statement still being extracted. */
  why: 'keyword' | 'recent' | 'pending_extraction';
}

export type RememberResult =
  | {
      stored: true;
      utterance_id: string;
      scope: 'person' | 'household';
      extraction: 'queued';
      redacted: BlockedCategory[];
      message?: string;
    }
  | {
      stored: false;
      reason: 'unknown_speaker' | 'guest_mode' | 'blocked_content';
      message: string;
      redacted?: BlockedCategory[];
    };

interface RecallRow {
  id: string;
  content: string;
  scope_type: ScopeType;
  type: FactType;
  confidence: number;
  sensitivity_tag: SensitivityTag;
  source: FactSource;
  at: Date;
  kind: 'fact' | 'utterance';
  rank: number;
}

const BLOCKED_LABELS: Record<BlockedCategory, string> = {
  card_number: 'card numbers',
  credential: 'passwords or codes',
  account_number: 'account numbers',
  national_id: 'ID numbers',
  diagnosis: 'medical diagnoses',
};

function blockedMessage(categories: BlockedCategory[], partlyStored: boolean): string {
  const list = categories.map((c) => BLOCKED_LABELS[c]).join(', ');
  return partlyStored
    ? `Stored, except the part with ${list}. I never keep those.`
    : `Not stored: I never keep ${list}.`;
}

/**
 * Scoped memory reads and writes. Reads are plain SQL over current facts plus statements still
 * waiting for extraction; the LLM never runs on this path (architecture.md §7.1).
 */
@Injectable()
export class MemoryService {
  constructor(
    @Inject(Db) private readonly db: Db,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async household(householdId: string): Promise<Household | null> {
    const { rows } = await this.db.query<Household>('SELECT id, name, region, timezone FROM household WHERE id = $1', [
      householdId,
    ]);
    return rows[0] ?? null;
  }

  /**
   * Match the device's speaker (person id or display name) against active memberships.
   * Unknown, ambiguous or low-confidence → no speaker: household facts only, and ask. Never guess.
   */
  async identify(householdId: string, speaker: string | undefined, confidence = 1): Promise<Identity> {
    const hint = speaker?.trim();
    if (!hint) return { speaker: null, candidate: null };
    const { rows } = await this.db.query<Omit<Speaker, 'confidence'>>(
      `SELECT p.id AS person_id, p.display_name, m.role
         FROM membership m JOIN person p ON p.id = m.person_id
        WHERE m.household_id = $1 AND m.revoked_at IS NULL
          AND (p.id::text = $2 OR lower(p.display_name) = lower($2))
        LIMIT 2`,
      [householdId, hint],
    );
    const [match] = rows;
    if (!match || rows.length > 1) return { speaker: null, candidate: null };
    if (confidence < this.config.speakerConfidenceThreshold) return { speaker: null, candidate: match.display_name };
    return { speaker: { ...match, confidence }, candidate: null };
  }

  /** Screen, store the statement, queue extraction — and acknowledge without waiting for the LLM. */
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

    const screened = screen(text);
    if (!screened.text) {
      return {
        stored: false,
        reason: 'blocked_content',
        redacted: screened.redactions,
        message: blockedMessage(screened.redactions, false),
      };
    }

    const utteranceId = await this.db.transaction(async (tx) => {
      const { rows } = await tx.query<{ id: string }>(
        `INSERT INTO utterance (household_id, region, person_id, scope_type, text, redactions)
         SELECT h.id, h.region, $2, $3, $4, $5 FROM household h WHERE h.id = $1
         RETURNING id`,
        [householdId, speaker.person_id, scope, screened.text, screened.redactions],
      );
      const row = rows[0];
      if (!row) throw new Error(`Household ${householdId} not found`);
      await enqueue(tx, householdId, 'extract', { utterance_id: row.id });
      return row.id;
    });

    return {
      stored: true,
      utterance_id: utteranceId,
      scope,
      extraction: 'queued',
      redacted: screened.redactions,
      ...(screened.redactions.length > 0 ? { message: blockedMessage(screened.redactions, true) } : {}),
    };
  }

  /**
   * Current facts visible to the speaker (their own + household), plus their statements still
   * waiting for extraction, so a fresh "remember" is recallable immediately.
   * With no trusted speaker, household only (architecture.md §1.3).
   */
  async recall(householdId: string, speaker: Speaker | null, query: string, limit: number): Promise<RecalledFact[]> {
    const { rows } = await this.db.query<RecallRow>(
      `WITH q AS (SELECT CASE WHEN $3 = '' THEN NULL ELSE to_tsquery('english', $3) END AS tsq),
       hits AS (
         SELECT f.id, f.content, f.scope_type, f.type, f.confidence, f.sensitivity_tag, f.source,
                f.valid_from AS at, 'fact' AS kind,
                CASE WHEN q.tsq IS NOT NULL AND f.content_tsv @@ q.tsq THEN ts_rank(f.content_tsv, q.tsq) ELSE 0 END AS rank
           FROM fact f, q
          WHERE f.household_id = $1
            AND f.valid_to IS NULL
            AND (f.ttl IS NULL OR f.valid_from + f.ttl > now())
            AND (f.scope_type = 'household' OR (f.scope_type = 'person' AND f.scope_id = $2::uuid))
         UNION ALL
         SELECT u.id, u.text, u.scope_type, 'episodic', 0.5::real, 'none',
                jsonb_build_object('speaker_id', u.person_id, 'origin', 'user_statement'),
                u.created_at, 'utterance',
                CASE WHEN q.tsq IS NOT NULL AND u.content_tsv @@ q.tsq THEN ts_rank(u.content_tsv, q.tsq) ELSE 0 END
           FROM utterance u, q
          WHERE u.household_id = $1
            AND u.status <> 'done'
            AND (u.scope_type = 'household' OR u.person_id = $2::uuid)
       )
       SELECT * FROM hits ORDER BY rank DESC, confidence DESC, at DESC LIMIT $4`,
      [householdId, speaker?.person_id ?? null, toTsQuery(query), limit],
    );
    return rows.map((r) => ({
      id: r.id,
      content: r.content,
      scope: r.scope_type,
      type: r.type,
      confidence: r.confidence,
      sensitivity: r.kind === 'utterance' ? (tagsFor(r.content)[0] ?? 'none') : r.sensitivity_tag,
      source: r.source,
      valid_from: r.at.toISOString(),
      why: r.kind === 'utterance' ? 'pending_extraction' : r.rank > 0 ? 'keyword' : 'recent',
    }));
  }
}

/** OR together prefix terms. Only letters and digits survive, so user text can't inject tsquery syntax. */
export function toTsQuery(query: string): string {
  const words = new Set((query.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter((w) => w.length > 2));
  return [...words].map((w) => `${w}:*`).join(' | ');
}
