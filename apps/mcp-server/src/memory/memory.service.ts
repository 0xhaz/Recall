import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  type BlockedCategory,
  type CommunicationStyle,
  type FactSource,
  type FactType,
  type MembershipRole,
  parseHlc,
  reciprocalRankFusion,
  resolveStyle,
  type ScopeType,
  type SensitivityTag,
  screen,
  tagsFor,
} from '@recall/core';
import type { Embedder, EmbedPurpose } from '@recall/llm';
import { APP_CONFIG, type AppConfig } from '../config.js';
import { Db } from '../db/db.js';
import { EventLog, lockHousehold } from '../events/event-log.service.js';
import { enqueue } from '../jobs/queue.js';
import { EMBEDDER } from '../llm/tokens.js';

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

/** Why a result was returned: meaning, shared words, filler from recent facts, or a statement not yet extracted. */
export type Why = 'semantic' | 'keyword' | 'recent' | 'pending_extraction';

export interface SearchHit {
  id: string;
  kind: 'fact' | 'utterance';
  content: string;
  scope: ScopeType;
  scope_id: string;
  type: FactType;
  confidence: number;
  sensitivity: SensitivityTag;
  source: FactSource;
  valid_from: string;
  valid_to: string | null;
  expires_at: string | null;
  superseded_by: string | null;
  similarity: number | null;
  why: Why;
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
  why: Why;
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

interface HitRow {
  id: string;
  kind: 'fact' | 'utterance';
  content: string;
  scope_type: ScopeType;
  scope_id: string;
  type: FactType;
  confidence: number;
  sensitivity_tag: SensitivityTag;
  source: FactSource;
  at: Date;
  valid_to: Date | null;
  expires_at: Date | null;
  superseded_by: string | null;
  rank: number;
  similarity: number | null;
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
 * Minimum cosine similarity for a vector hit, by what is being compared (qwen3-embedding:0.6b,
 * calibrated 2026-09-11). A statement against a fact (verify_claim, forget by topic) is compared
 * like two facts: related ≥ 0.77, unrelated ≤ 0.68. A question against a fact (recall, explain)
 * sits on a lower scale; with the query instruction, relevant pairs scored 0.35–0.71 and
 * unrelated ones at most 0.32.
 */
export const SIMILARITY_FLOOR = { statement: 0.72, query: 0.34 } as const;
export type SearchMode = keyof typeof SIMILARITY_FLOOR;
const CANDIDATES = 20;
const QUERY_CACHE_SIZE = 500;
const MAX_FUTURE_DRIFT_MS = 5 * 60_000;

// Facts the speaker may see: their own person facts and household facts, never tombstones.
const VISIBLE_FACT = `f.household_id = $1 AND f.forgotten_at IS NULL
  AND (f.scope_type = 'household' OR (f.scope_type = 'person' AND f.scope_id = $2::uuid))`;
const CURRENT = 'f.valid_to IS NULL AND (f.ttl IS NULL OR f.valid_from + f.ttl > now())';
const CLOSED = 'f.valid_to IS NOT NULL';
const CAREGIVER_ONLY = "f.source->>'origin' = 'caregiver'";
const FACT_COLUMNS = `f.id, 'fact' AS kind, f.content, f.scope_type, f.scope_id::text AS scope_id, f.type,
  f.confidence, f.sensitivity_tag, f.source, f.valid_from AS at, f.valid_to, f.valid_from + f.ttl AS expires_at,
  f.superseded_by`;

/**
 * Scoped memory reads and writes. Reads are SQL over current facts plus statements still waiting
 * for extraction, fused from keyword and vector search; no LLM on this path (architecture.md §7.1).
 */
@Injectable()
export class MemoryService {
  private readonly logger = new Logger(MemoryService.name);
  private embedderDown = false;
  /** Recent query embeddings, least recently used first: a repeated question skips the model. */
  private readonly queryVectors = new Map<string, number[]>();

  constructor(
    @Inject(Db) private readonly db: Db,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(EventLog) private readonly events: EventLog,
    @Inject(EMBEDDER) private readonly embedder: Embedder,
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

  /**
   * Screen, store the statement, queue extraction — and acknowledge without waiting for the LLM.
   * `saidHlc` is the device's stamp for when it was said, so a late upload from an offline device
   * is ordered before any forget made since.
   */
  async remember(
    householdId: string,
    speaker: Speaker | null,
    text: string,
    scope: 'person' | 'household',
    deviceId?: string,
    saidHlc?: string,
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

    const said = saidHlc ? parseHlc(saidHlc) : null;
    const saidAt = said && said.wall <= Date.now() + MAX_FUTURE_DRIFT_MS ? saidHlc : undefined;
    const utteranceId = randomUUID();
    await this.db.transaction(async (tx) => {
      await lockHousehold(tx, householdId);
      // The log records that something was said, never the words: raw speech stays on the server.
      const hlc = await this.events.append(tx, householdId, {
        kind: 'utterance.recorded',
        payload: { utterance_id: utteranceId, person_id: speaker.person_id, scope },
        personId: speaker.person_id,
        deviceId,
      });
      const { rowCount } = await tx.query(
        `INSERT INTO utterance (id, household_id, region, person_id, scope_type, text, redactions, hlc, device_id)
         SELECT $1, h.id, h.region, $3, $4, $5, $6, $7, $8 FROM household h WHERE h.id = $2`,
        [
          utteranceId,
          householdId,
          speaker.person_id,
          scope,
          screened.text,
          screened.redactions,
          saidAt ?? hlc,
          deviceId ?? null,
        ],
      );
      if (!rowCount) throw new Error(`Household ${householdId} not found`);
      await enqueue(tx, householdId, 'extract', { utterance_id: utteranceId });
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

  /** What session_brief and recall return: current facts and pending statements, best first. */
  async recall(householdId: string, speaker: Speaker | null, query: string, limit: number): Promise<RecalledFact[]> {
    const hits = await this.search(householdId, speaker, query, { limit });
    return hits.map(({ id, content, scope, type, confidence, sensitivity, source, valid_from, why }) => ({
      id,
      content,
      scope,
      type,
      confidence,
      sensitivity,
      source,
      valid_from,
      why,
    }));
  }

  /**
   * Facts visible to the speaker (their own + household; household only with no trusted speaker,
   * architecture.md §1.3). Keyword and vector results are fused by reciprocal rank; the remaining
   * slots are filled with the most confident recent facts. `closed` searches superseded history;
   * `mode` says whether the input is a question (default) or a statement to compare with facts.
   */
  async search(
    householdId: string,
    speaker: Speaker | null,
    query: string,
    opts: { limit: number; closed?: boolean; mode?: SearchMode; keywordOnly?: boolean },
  ): Promise<SearchHit[]> {
    const personId = speaker?.person_id ?? null;
    // Care mode: only what a caregiver entered is ever stated to the person, nothing inferred (design.md §5).
    const careMode = speaker?.role === 'cared_for';
    const period = opts.closed ? CLOSED : CURRENT;
    const when = careMode ? `${period} AND ${CAREGIVER_ONLY}` : period;
    // The speaker's own name would match every fact about them, so it never counts as a keyword.
    const tsquery = toTsQuery(query, nameWords(speaker?.display_name));
    const withPending = !opts.closed && !careMode;
    const [keyword, vector] = await Promise.all([
      this.keywordHits(householdId, personId, tsquery, when, withPending, Math.max(opts.limit, CANDIDATES)),
      query.trim() && !opts.keywordOnly
        ? this.vectorHits(householdId, personId, query, when, opts.mode ?? 'query')
        : [],
    ]);

    const scores = reciprocalRankFusion([keyword.filter((r) => r.rank > 0).map((r) => r.id), vector.map((r) => r.id)]);
    const rows = new Map<string, HitRow>();
    for (const row of [...keyword, ...vector]) {
      const seen = rows.get(row.id);
      rows.set(
        row.id,
        seen ? { ...seen, rank: Math.max(seen.rank, row.rank), similarity: seen.similarity ?? row.similarity } : row,
      );
    }
    const scored = [...rows.values()]
      .filter((r) => scores.has(r.id))
      .sort((a, b) => (scores.get(b.id) ?? 0) - (scores.get(a.id) ?? 0));
    const fillers = keyword.filter((r) => !scores.has(r.id));
    return [...scored, ...fillers].slice(0, opts.limit).map(toHit);
  }

  async style(personId: string): Promise<CommunicationStyle> {
    const { rows } = await this.db.query<{ communication_style: unknown }>(
      'SELECT communication_style FROM person WHERE id = $1',
      [personId],
    );
    return resolveStyle(rows[0]?.communication_style);
  }

  /** The tone dial belongs to the person, so it follows them to every household and device. */
  async setStyle(personId: string, patch: Partial<CommunicationStyle>): Promise<CommunicationStyle> {
    const given = Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined));
    const style = resolveStyle({ ...(await this.style(personId)), ...given });
    await this.db.query('UPDATE person SET communication_style = $2 WHERE id = $1', [personId, JSON.stringify(style)]);
    return style;
  }

  private async keywordHits(
    householdId: string,
    personId: string | null,
    tsquery: string,
    when: string,
    withPending: boolean,
    limit: number,
  ): Promise<HitRow[]> {
    const rank = (tsv: string) =>
      `CASE WHEN q.tsq IS NOT NULL AND ${tsv} @@ q.tsq THEN ts_rank(${tsv}, q.tsq) ELSE 0 END`;
    const pending = withPending
      ? `UNION ALL
         SELECT u.id, 'utterance', u.text, u.scope_type,
                CASE WHEN u.scope_type = 'person' THEN u.person_id::text ELSE u.household_id::text END,
                'episodic', 0.5::real, 'none', jsonb_build_object('speaker_id', u.person_id, 'origin', 'user_statement'),
                u.created_at, NULL::timestamptz, NULL::timestamptz, NULL::uuid, ${rank('u.content_tsv')}, NULL::float8
           FROM utterance u, q
          WHERE u.household_id = $1 AND u.status IN ('pending', 'failed') AND u.text <> ''
            AND (u.scope_type = 'household' OR u.person_id = $2::uuid)`
      : '';
    const { rows } = await this.db.query<HitRow>(
      `WITH q AS (SELECT CASE WHEN $3 = '' THEN NULL ELSE to_tsquery('english', $3) END AS tsq)
       SELECT * FROM (
         SELECT ${FACT_COLUMNS}, ${rank('f.content_tsv')} AS rank, NULL::float8 AS similarity
           FROM fact f, q
          WHERE ${VISIBLE_FACT} AND ${when}
         ${pending}
       ) hits
       ORDER BY rank DESC, confidence DESC, at DESC
       LIMIT $4`,
      [householdId, personId, tsquery, limit],
    );
    return rows;
  }

  private async vectorHits(
    householdId: string,
    personId: string | null,
    query: string,
    when: string,
    mode: SearchMode,
  ): Promise<HitRow[]> {
    let vector: number[] | undefined;
    try {
      vector = await this.embedQuery(query, mode === 'query' ? 'query' : 'document');
    } catch (err) {
      // Keyword search still works; say so once rather than on every call.
      if (!this.embedderDown) this.logger.warn(`Embeddings unavailable, keyword search only: ${String(err)}`);
      this.embedderDown = true;
      return [];
    }
    this.embedderDown = false;
    if (!vector) return [];
    const { rows } = await this.db.query<HitRow>(
      `SELECT ${FACT_COLUMNS}, 0::real AS rank, 1 - (f.embedding <=> $3::vector) AS similarity
         FROM fact f
        WHERE ${VISIBLE_FACT} AND ${when} AND f.embedding IS NOT NULL
        ORDER BY f.embedding <=> $3::vector
        LIMIT ${CANDIDATES}`,
      [householdId, personId, JSON.stringify(vector)],
    );
    return rows.filter((r) => (r.similarity ?? 0) >= SIMILARITY_FLOOR[mode]);
  }

  private async embedQuery(text: string, purpose: EmbedPurpose): Promise<number[] | undefined> {
    const key = `${purpose}:${text.trim().toLowerCase()}`;
    const cached = this.queryVectors.get(key);
    if (cached) {
      this.queryVectors.delete(key);
      this.queryVectors.set(key, cached);
      return cached;
    }
    const [vector] = await this.embedder.embed([text], purpose);
    if (vector) {
      this.queryVectors.set(key, vector);
      const oldest = this.queryVectors.keys().next().value;
      if (this.queryVectors.size > QUERY_CACHE_SIZE && oldest !== undefined) this.queryVectors.delete(oldest);
    }
    return vector;
  }
}

function toHit(r: HitRow): SearchHit {
  // Vector rows are already filtered by their floor, so any similarity here means a match by meaning.
  const why: Why =
    r.kind === 'utterance'
      ? 'pending_extraction'
      : r.rank > 0
        ? 'keyword'
        : r.similarity !== null
          ? 'semantic'
          : 'recent';
  return {
    id: r.id,
    kind: r.kind,
    content: r.content,
    scope: r.scope_type,
    scope_id: r.scope_id,
    type: r.type,
    confidence: r.confidence,
    sensitivity: r.kind === 'utterance' ? (tagsFor(r.content)[0] ?? 'none') : r.sensitivity_tag,
    source: r.source,
    valid_from: r.at.toISOString(),
    valid_to: r.valid_to?.toISOString() ?? null,
    expires_at: r.expires_at?.toISOString() ?? null,
    superseded_by: r.superseded_by,
    similarity: r.similarity,
    why,
  };
}

function nameWords(name: string | undefined): Set<string> {
  return new Set((name?.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter((w) => w.length > 2));
}

/** OR together prefix terms. Only letters and digits survive, so user text can't inject tsquery syntax. */
export function toTsQuery(query: string, exclude: ReadonlySet<string> = new Set()): string {
  const words = new Set(
    (query.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter((w) => w.length > 2 && !exclude.has(w)),
  );
  return [...words].map((w) => `${w}:*`).join(' | ');
}
