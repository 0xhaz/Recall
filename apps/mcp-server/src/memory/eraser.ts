import { Inject, Injectable } from '@nestjs/common';
import type { Queryable } from '../db/db.js';
import { EventLog } from '../events/event-log.service.js';

/**
 * Forgetting (architecture.md §1.3, §4): a tombstone in the log so every device drops the fact,
 * and the words erased everywhere Recall kept them — the fact, the history it superseded, the
 * statement it came from, past fact.created events and snapshots. The fact row stays as a
 * tombstone (with its embedding, to stop stale statements bringing it back) until maintenance
 * removes it after retention + 30 days.
 */
@Injectable()
export class Eraser {
  constructor(@Inject(EventLog) private readonly events: EventLog) {}

  /** Caller must hold lockHousehold. Returns every fact id tombstoned, including superseded history. */
  async forgetFacts(tx: Queryable, householdId: string, factIds: string[], by: string | null): Promise<string[]> {
    if (factIds.length === 0) return [];
    const { rows } = await tx.query<{ id: string; utterance_id: string | null }>(
      `WITH RECURSIVE chain AS (
         SELECT id FROM fact WHERE household_id = $1 AND id = ANY($2::uuid[]) AND forgotten_at IS NULL
         UNION
         SELECT f.id FROM fact f JOIN chain c ON f.superseded_by = c.id WHERE f.forgotten_at IS NULL
       )
       UPDATE fact f
          SET forgotten_at = now(), valid_to = COALESCE(f.valid_to, now()), content = '', entities = '[]'
         FROM chain
        WHERE f.id = chain.id
       RETURNING f.id, f.source->>'utterance_id' AS utterance_id`,
      [householdId, factIds],
    );
    const ids = rows.map((r) => r.id);
    if (ids.length === 0) return [];

    for (const id of ids) {
      const hlc = await this.events.factChanged(tx, id, 'fact.forgotten', { by });
      await tx.query(
        `UPDATE snapshot
            SET data = jsonb_set(data #- ARRAY['facts', $2], ARRAY['removed', $2],
                                 jsonb_build_object('hlc', $3::text, 'reason', 'forgotten'))
          WHERE household_id = $1`,
        [householdId, id, hlc],
      );
    }
    await tx.query(
      `UPDATE event SET payload = jsonb_set(payload, '{fact,content}', '""')
        WHERE household_id = $1 AND kind = 'fact.created' AND payload->'fact'->>'id' = ANY($2::text[])`,
      [householdId, ids],
    );
    const utterances = rows.map((r) => r.utterance_id).filter((u): u is string => !!u);
    if (utterances.length > 0) {
      await tx.query(
        `UPDATE utterance SET text = '', status = 'forgotten' WHERE household_id = $1 AND id = ANY($2::uuid[])`,
        [householdId, utterances],
      );
    }
    return ids;
  }

  /** Statements forgotten before extraction: erased, and their jobs cancelled. Caller holds lockHousehold. */
  async forgetUtterances(tx: Queryable, householdId: string, utteranceIds: string[]): Promise<number> {
    if (utteranceIds.length === 0) return 0;
    const { rowCount } = await tx.query(
      `UPDATE utterance SET text = '', status = 'forgotten'
        WHERE household_id = $1 AND id = ANY($2::uuid[]) AND status <> 'forgotten'`,
      [householdId, utteranceIds],
    );
    await tx.query(
      `UPDATE job SET status = 'done', last_error = 'forgotten before extraction'
        WHERE household_id = $1 AND kind = 'extract' AND status IN ('queued', 'running')
          AND payload->>'utterance_id' = ANY($2::text[])`,
      [householdId, utteranceIds],
    );
    return rowCount ?? 0;
  }

  /**
   * Remove rules, tombstoned in the log so every device drops them. With `erase` (forget me) the
   * rule's words go too, from the row and from past rule.set events. Caller holds lockHousehold.
   */
  async removeRules(
    tx: Queryable,
    householdId: string,
    ruleIds: string[],
    by: string | null,
    erase = false,
  ): Promise<number> {
    let removed = 0;
    for (const id of ruleIds) {
      const { rowCount } = await tx.query(
        `UPDATE rule SET removed_at = now(), removed_by = $3, text = CASE WHEN $4 THEN '' ELSE text END
          WHERE household_id = $1 AND id = $2 AND removed_at IS NULL`,
        [householdId, id, by, erase],
      );
      if (!rowCount) continue;
      await this.events.ruleChanged(tx, id, 'rule.removed');
      removed++;
    }
    if (erase && ruleIds.length > 0) {
      await tx.query(
        `UPDATE event SET payload = jsonb_set(payload, '{rule,text}', '""')
          WHERE household_id = $1 AND kind = 'rule.set' AND payload->'rule'->>'id' = ANY($2::text[])`,
        [householdId, ruleIds],
      );
    }
    return removed;
  }
}
