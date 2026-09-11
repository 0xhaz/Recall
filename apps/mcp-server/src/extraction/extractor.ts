import { Inject, Injectable } from '@nestjs/common';
import { type MembershipRole, temporalStamp } from '@recall/core';
import type { Embedder } from '@recall/llm';
import type { HouseholdContext } from '../auth/household-auth.js';
import { Db, type Queryable } from '../db/db.js';
import { EventLog, lockHousehold } from '../events/event-log.service.js';
import { EMBEDDER } from '../llm/tokens.js';
import { UsageMeter } from '../llm/usage-meter.js';
import { type Candidate, ExtractionReply, normalise } from './normalise.js';
import { EXTRACTION_SCHEMA, extractionMessages, JUDGE_SCHEMA, JudgeReply, judgeMessages } from './prompt.js';

/**
 * Cosine similarity above which an existing fact is sent to the judge. Calibrated on
 * qwen3-embedding:0.6b (2026-09-11): unrelated pairs ≤ 0.68, real updates ≥ 0.77.
 * Duplicates and updates overlap (0.95–0.99), so similarity alone never decides.
 */
const NEIGHBOUR_SIMILARITY = 0.72;
/** A statement made before a forget that is this close to the forgotten fact is not stored again. */
const STALE_SIMILARITY = 0.85;

interface UtteranceRow {
  id: string;
  household_id: string;
  region: string;
  person_id: string;
  text: string;
  status: string;
  hlc: string | null;
  display_name: string;
  role: MembershipRole | null;
  timezone: string;
}

interface Neighbour {
  id: string;
  content: string;
  similarity: number;
  durable: boolean;
}

type Decision = { candidate: Candidate; scopeId: string; vector: string } & (
  | { action: 'insert' }
  | { action: 'skip' }
  | { action: 'reinforce' | 'supersede'; target: string }
);

/**
 * Turns an utterance into facts: extract (LLM) → normalise (rules) → embed → dedupe or
 * supersede against current facts (LLM judge) → write everything in one transaction.
 */
@Injectable()
export class Extractor {
  constructor(
    @Inject(Db) private readonly db: Db,
    @Inject(UsageMeter) private readonly meter: UsageMeter,
    @Inject(EMBEDDER) private readonly embedder: Embedder,
    @Inject(EventLog) private readonly events: EventLog,
  ) {}

  async extractUtterance(utteranceId: string): Promise<string[]> {
    const { rows } = await this.db.query<UtteranceRow>(
      `SELECT u.id, u.household_id, u.region, u.person_id, u.text, u.status, u.hlc, p.display_name, m.role, h.timezone
         FROM utterance u
         JOIN person p ON p.id = u.person_id
         JOIN household h ON h.id = u.household_id
         LEFT JOIN membership m ON m.household_id = u.household_id AND m.person_id = u.person_id AND m.revoked_at IS NULL
        WHERE u.id = $1`,
      [utteranceId],
    );
    const u = rows[0];
    if (!u || u.status === 'done' || u.status === 'forgotten') return [];

    const ctx: HouseholdContext = { householdId: u.household_id, region: u.region };
    const now = new Date();
    const reply = await this.meter.chat(ctx, 'extract', {
      messages: extractionMessages({ speaker: u.display_name, statement: u.text, timezone: u.timezone, now }),
      jsonSchema: EXTRACTION_SCHEMA,
    });
    const { facts } = ExtractionReply.parse(JSON.parse(reply.text));
    const candidates = normalise(facts, {
      utterance: u.text,
      role: u.role ?? 'adult',
      today: temporalStamp(u.timezone, now).local_date,
    });

    const vectors = await this.embedder.embed(candidates.map((c) => c.content));
    const decisions: Decision[] = [];
    for (const [i, candidate] of candidates.entries()) {
      const vector = vectors[i];
      if (!vector) throw new Error(`Embedder returned ${vectors.length} vectors for ${candidates.length} facts`);
      decisions.push(await this.decide(ctx, u, candidate, vector));
    }
    return this.apply(u, decisions);
  }

  /** Embed facts written without one (seed data, older rows) so semantic search can find them. */
  async embedMissing(householdId: string, limit = 100): Promise<number> {
    const { rows } = await this.db.query<{ id: string; content: string }>(
      `SELECT id, content FROM fact
        WHERE household_id = $1 AND embedding IS NULL AND forgotten_at IS NULL AND content <> ''
        ORDER BY created_at LIMIT $2`,
      [householdId, limit],
    );
    if (rows.length === 0) return 0;
    const vectors = await this.embedder.embed(rows.map((r) => r.content));
    for (const [i, row] of rows.entries()) {
      const vector = vectors[i];
      if (vector) {
        await this.db.query('UPDATE fact SET embedding = $2::vector WHERE id = $1 AND embedding IS NULL', [
          row.id,
          JSON.stringify(vector),
        ]);
      }
    }
    return rows.length;
  }

  private async decide(
    ctx: HouseholdContext,
    u: UtteranceRow,
    candidate: Candidate,
    vector: number[],
  ): Promise<Decision> {
    const scopeId = candidate.scope === 'person' ? u.person_id : u.household_id;
    const literal = JSON.stringify(vector);
    const base = { candidate, scopeId, vector: literal };

    // Something said before a forget (e.g. uploaded late by an offline device) can't bring the
    // forgotten fact back. Said again after the forget, it is stored as new.
    if (u.hlc) {
      const { rows: tombstones } = await this.db.query<{ similarity: number }>(
        `SELECT 1 - (embedding <=> $4::vector) AS similarity FROM fact
          WHERE household_id = $1 AND scope_type = $2 AND scope_id = $3
            AND forgotten_at IS NOT NULL AND embedding IS NOT NULL AND hlc > $5
          ORDER BY embedding <=> $4::vector
          LIMIT 1`,
        [u.household_id, candidate.scope, scopeId, literal, u.hlc],
      );
      if ((tombstones[0]?.similarity ?? 0) >= STALE_SIMILARITY) return { ...base, action: 'skip' };
    }

    const { rows } = await this.db.query<Neighbour>(
      `SELECT id, content, 1 - (embedding <=> $4::vector) AS similarity, ttl IS NULL AS durable
         FROM fact
        WHERE household_id = $1 AND scope_type = $2 AND scope_id = $3
          AND valid_to IS NULL AND embedding IS NOT NULL
        ORDER BY embedding <=> $4::vector
        LIMIT 3`,
      [u.household_id, candidate.scope, scopeId, literal],
    );
    const neighbours = rows.filter((n) => n.similarity >= NEIGHBOUR_SIMILARITY);
    if (neighbours.length === 0) return { ...base, action: 'insert' };

    const exact = neighbours.find((n) => n.content.toLowerCase() === candidate.content.toLowerCase());
    if (exact) return { ...base, action: 'reinforce', target: exact.id };

    const reply = await this.meter.chat(ctx, 'dedupe', {
      messages: judgeMessages(
        candidate.content,
        neighbours.map((n) => n.content),
      ),
      jsonSchema: JUDGE_SCHEMA,
    });
    const { verdict, match } = JudgeReply.parse(JSON.parse(reply.text));
    const target = match === null ? undefined : neighbours[match - 1];
    if (!target || verdict === 'new') return { ...base, action: 'insert' };
    if (verdict === 'same') return { ...base, action: 'reinforce', target: target.id };
    // A temporary situation never replaces a durable fact ("eating fish this week" vs "vegetarian").
    if (candidate.expiresOn && target.durable) return { ...base, action: 'insert' };
    return { ...base, action: 'supersede', target: target.id };
  }

  private apply(u: UtteranceRow, decisions: Decision[]): Promise<string[]> {
    return this.db.transaction(async (tx) => {
      await lockHousehold(tx, u.household_id);
      const { rows: current } = await tx.query<{ status: string }>(
        'SELECT status FROM utterance WHERE id = $1 FOR UPDATE',
        [u.id],
      );
      // Forgotten while the model was working on it: write nothing.
      if (current[0]?.status === 'forgotten') return [];
      const factIds: string[] = [];
      for (const d of decisions) {
        if (d.action === 'skip') continue;
        if (d.action === 'reinforce') {
          // Recurrence is what turns a mention into a trait.
          const { rows } = await tx.query<{ confidence: number }>(
            'UPDATE fact SET confidence = LEAST(0.95, GREATEST(confidence, $2) + 0.1) WHERE id = $1 RETURNING confidence',
            [d.target, d.candidate.confidence],
          );
          await this.events.factChanged(tx, d.target, 'fact.reinforced', { confidence: rows[0]?.confidence });
          factIds.push(d.target);
          continue;
        }
        const id = await insertFact(tx, u, d);
        await this.events.factCreated(tx, id);
        if (d.action === 'supersede') {
          // Bi-temporal: close the old fact and link it, never delete it.
          await tx.query('UPDATE fact SET valid_to = now(), superseded_by = $2 WHERE id = $1 AND valid_to IS NULL', [
            d.target,
            id,
          ]);
          await this.events.factChanged(tx, d.target, 'fact.superseded', { superseded_by: id });
        }
        factIds.push(id);
      }
      await tx.query(`UPDATE utterance SET status = 'done', fact_ids = $2, processed_at = now() WHERE id = $1`, [
        u.id,
        factIds,
      ]);
      return factIds;
    });
  }
}

async function insertFact(tx: Queryable, u: UtteranceRow, d: Decision): Promise<string> {
  const source = { speaker_id: u.person_id, origin: 'extraction', utterance_id: u.id };
  const { rows } = await tx.query<{ id: string }>(
    `INSERT INTO fact (household_id, region, scope_type, scope_id, type, content, source, confidence,
                       sensitivity_tag, embedding, ttl)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::vector,
             CASE WHEN $11::date IS NULL THEN NULL
                  ELSE (($11::date + 1)::timestamp AT TIME ZONE $12) - now() END)
     RETURNING id`,
    [
      u.household_id,
      u.region,
      d.candidate.scope,
      d.scopeId,
      d.candidate.type,
      d.candidate.content,
      JSON.stringify(source),
      d.candidate.confidence,
      d.candidate.sensitivity,
      d.vector,
      d.candidate.expiresOn,
      u.timezone,
    ],
  );
  const row = rows[0];
  if (!row) throw new Error('Fact insert returned no id');
  return row.id;
}
