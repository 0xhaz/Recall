import { Inject, Injectable } from '@nestjs/common';
import type { ScopeType } from '@recall/core';
import { audit } from '../audit.js';
import { Db } from '../db/db.js';
import { lockHousehold } from '../events/event-log.service.js';
import { Eraser } from './eraser.js';
import { MemoryService, type Speaker } from './memory.service.js';

interface Target {
  id: string;
  kind: 'fact' | 'utterance';
  content: string;
  scope: ScopeType;
  scope_id: string;
}

export type ForgetResult =
  | { forgotten: { id: string; content: string }[]; message: string }
  | {
      forgotten: [];
      needs_confirmation: { id: string; content: string; kind: 'fact' | 'pending' }[];
      message: string;
    }
  | { forgotten: []; refused: 'unknown_speaker' | 'not_allowed' | 'not_found'; message: string };

export interface ForgetMeReport {
  households: number;
  facts_forgotten: number;
  statements_erased: number;
  memberships_revoked: number;
}

/** Personal facts are forgotten by their owner; household facts by an adult of that household. */
function canForget(speaker: Speaker, target: Pick<Target, 'scope' | 'scope_id'>): boolean {
  if (target.scope === 'person') return target.scope_id === speaker.person_id;
  return speaker.role === 'owner' || speaker.role === 'adult';
}

const quoted = (targets: Pick<Target, 'content'>[]) => targets.map((t) => `“${t.content}”`).join(', ');

@Injectable()
export class ForgetService {
  constructor(
    @Inject(Db) private readonly db: Db,
    @Inject(MemoryService) private readonly memory: MemoryService,
    @Inject(Eraser) private readonly eraser: Eraser,
  ) {}

  /**
   * Forget by topic or by id. Forgetting erases, so a topic is acted on only when exactly one
   * thing matches and shares actual words with the request; otherwise the candidates come back
   * for the person to choose from.
   */
  async forget(
    householdId: string,
    speaker: Speaker | null,
    request: { topic?: string; factIds?: string[] },
  ): Promise<ForgetResult> {
    if (!speaker) {
      return {
        forgotten: [],
        refused: 'unknown_speaker',
        message: 'I need to know who is asking before I forget anything. Ask who it is.',
      };
    }
    if (speaker.role === 'guest') {
      return { forgotten: [], refused: 'not_allowed', message: "Guests can't change what the household remembers." };
    }

    let targets: Target[];
    if (request.factIds?.length) {
      targets = await this.byIds(householdId, speaker, request.factIds);
    } else if (request.topic?.trim()) {
      const hits = (
        await this.memory.search(householdId, speaker, request.topic, { limit: 5, mode: 'statement' })
      ).filter((h) => h.why !== 'recent');
      const allowed = hits.filter((h) => canForget(speaker, h));
      if (hits.length > 0 && allowed.length === 0) return this.notAllowed();
      const [only] = allowed;
      if (only && hits.length === 1 && only.why !== 'semantic') {
        targets = [only];
      } else if (allowed.length > 0) {
        return {
          forgotten: [],
          needs_confirmation: allowed.map((h) => ({
            id: h.id,
            content: h.content,
            kind: h.kind === 'fact' ? 'fact' : 'pending',
          })),
          message:
            'More than one thing matches, or the match is only approximate. Ask which to forget, then call forget with fact_ids.',
        };
      } else {
        targets = [];
      }
    } else {
      return { forgotten: [], refused: 'not_found', message: 'Say what to forget, or pass fact_ids.' };
    }

    if (targets.length === 0) {
      return {
        forgotten: [],
        refused: 'not_found',
        message: request.topic ? `Nothing I keep matches “${request.topic}”.` : 'I have no such fact.',
      };
    }
    if (targets.some((t) => !canForget(speaker, t))) return this.notAllowed();

    await this.db.transaction(async (tx) => {
      await lockHousehold(tx, householdId);
      const facts = targets.filter((t) => t.kind === 'fact').map((t) => t.id);
      const pending = targets.filter((t) => t.kind === 'utterance').map((t) => t.id);
      await this.eraser.forgetFacts(tx, householdId, facts, speaker.person_id);
      await this.eraser.forgetUtterances(tx, householdId, pending);
    });
    return {
      forgotten: targets.map((t) => ({ id: t.id, content: t.content })),
      message: `Forgotten on every device: ${quoted(targets)}.`,
    };
  }

  /**
   * "Forget me" (architecture.md §1.3): tombstone every personal fact in every household, erase
   * what the person said, drop their conversations and revoke their memberships. The person record
   * itself is purged by maintenance 30 days later.
   */
  async forgetPerson(personId: string): Promise<ForgetMeReport> {
    const { rows: households } = await this.db.query<{ household_id: string }>(
      `SELECT household_id FROM membership WHERE person_id = $1 AND revoked_at IS NULL
       UNION
       SELECT household_id FROM fact WHERE scope_type = 'person' AND scope_id = $1 AND forgotten_at IS NULL`,
      [personId],
    );
    const report: ForgetMeReport = {
      households: households.length,
      facts_forgotten: 0,
      statements_erased: 0,
      memberships_revoked: 0,
    };

    for (const { household_id: householdId } of households) {
      await this.db.transaction(async (tx) => {
        await lockHousehold(tx, householdId);
        const { rows: facts } = await tx.query<{ id: string }>(
          `SELECT id FROM fact WHERE household_id = $1 AND scope_type = 'person' AND scope_id = $2 AND forgotten_at IS NULL`,
          [householdId, personId],
        );
        const forgotten = await this.eraser.forgetFacts(
          tx,
          householdId,
          facts.map((f) => f.id),
          personId,
        );
        report.facts_forgotten += forgotten.length;

        const { rows: said } = await tx.query<{ id: string }>(
          `SELECT id FROM utterance WHERE household_id = $1 AND person_id = $2 AND status <> 'forgotten'`,
          [householdId, personId],
        );
        report.statements_erased += await this.eraser.forgetUtterances(
          tx,
          householdId,
          said.map((u) => u.id),
        );
        await tx.query('DELETE FROM session WHERE household_id = $1 AND person_id = $2', [householdId, personId]);
        const { rows: rules } = await tx.query<{ id: string }>(
          `SELECT id FROM rule WHERE household_id = $1 AND scope_type = 'person' AND scope_id = $2 AND removed_at IS NULL`,
          [householdId, personId],
        );
        await this.eraser.removeRules(
          tx,
          householdId,
          rules.map((r) => r.id),
          personId,
          true,
        );
        // Routines are memory too (architecture.md §1.3): what they did, and when, goes with them.
        await tx.query('DELETE FROM routine WHERE household_id = $1 AND person_id = $2', [householdId, personId]);
        await tx.query('DELETE FROM activity WHERE household_id = $1 AND person_id = $2', [householdId, personId]);
        for (const table of ['action', 'context_state', 'context_baseline', 'track_affinity']) {
          await tx.query(`DELETE FROM ${table} WHERE household_id = $1 AND person_id = $2`, [householdId, personId]);
        }
        const revoked = await tx.query(
          'UPDATE membership SET revoked_at = now() WHERE household_id = $1 AND person_id = $2 AND revoked_at IS NULL',
          [householdId, personId],
        );
        report.memberships_revoked += revoked.rowCount ?? 0;
        await audit(tx, {
          householdId,
          actorId: personId,
          action: 'person.forget_me',
          targetType: 'person',
          targetId: personId,
          detail: { facts: forgotten.length },
        });
      });
    }
    await this.db.query('UPDATE console_session SET revoked_at = now() WHERE person_id = $1 AND revoked_at IS NULL', [
      personId,
    ]);
    return report;
  }

  /** Current facts and pending statements with these ids that the speaker can see. */
  private async byIds(householdId: string, speaker: Speaker, ids: string[]): Promise<Target[]> {
    const { rows } = await this.db.query<Target>(
      `SELECT id, 'fact' AS kind, content, scope_type AS scope, scope_id::text AS scope_id FROM fact
        WHERE household_id = $1 AND id = ANY($2::uuid[]) AND forgotten_at IS NULL AND valid_to IS NULL
          AND (scope_type = 'household' OR scope_id = $3::uuid)
       UNION ALL
       SELECT id, 'utterance', text, scope_type,
              CASE WHEN scope_type = 'person' THEN person_id::text ELSE household_id::text END
         FROM utterance
        WHERE household_id = $1 AND id = ANY($2::uuid[]) AND status IN ('pending', 'failed')
          AND (scope_type = 'household' OR person_id = $3::uuid)`,
      [householdId, ids, speaker.person_id],
    );
    return rows;
  }

  private notAllowed(): ForgetResult {
    return {
      forgotten: [],
      refused: 'not_allowed',
      message: 'Only the person a fact is about can forget it; household facts need an adult of the household.',
    };
  }
}
