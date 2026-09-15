import { Inject, Injectable } from '@nestjs/common';
import {
  type ActionDetails,
  mineRepurchases,
  type PastPurchase,
  type RepeatItem,
  type StatedCadence,
  statedCadence,
  temporalStamp,
} from '@recall/core';
import { Db } from '../db/db.js';
import type { Household, Speaker } from '../memory/memory.service.js';
import { localMinute } from '../routines/activity.js';

/** A year, so a quarterly filter still has three purchases behind it. */
const WINDOW_DAYS = 365;
const MAX_ROWS = 400;

// Purchases the speaker may see: the household's, plus their own. Same rule as facts — a purchase
// made for one person is not another person's business, even to count.
const VISIBLE = `household_id = $1 AND status = 'executed' AND intent IN ('order.food', 'purchase')
  AND (person_id IS NULL OR person_id = $2::uuid)`;

export interface PurchaseRow {
  action_id: string;
  label: string;
  venue: string | null;
  amount: number | null;
  currency: string | null;
  local_date: string;
  /** Who it was for; null for the household. */
  person: string | null;
}

export interface PurchaseHistory {
  /** Every purchase in the window, newest first, one row per shop. */
  recent: { at: string; venue: string | null; amount: number | null; currency: string | null; items: string[] }[];
  /** What this household buys on a cycle, soonest due first. */
  repeats: RepeatItem[];
  /** The subset of `repeats` that is due or overdue now. */
  due: RepeatItem[];
}

@Injectable()
export class RepurchaseService {
  constructor(@Inject(Db) private readonly db: Db) {}

  async history(
    household: Household,
    speaker: Speaker | null,
    opts: { item?: string; limit?: number; now?: Date } = {},
  ): Promise<PurchaseHistory> {
    const now = opts.now ?? new Date();
    const today = temporalStamp(household.timezone, now).local_date;
    const { rows } = await this.db.query<{
      id: string;
      person_id: string | null;
      details: ActionDetails;
      decided_at: Date;
    }>(
      `SELECT id, person_id, details, decided_at FROM action
        WHERE ${VISIBLE} AND decided_at > $3::timestamptz - interval '${WINDOW_DAYS} days'
        ORDER BY decided_at DESC LIMIT ${MAX_ROWS}`,
      [household.id, speaker?.person_id ?? null, now],
    );

    const purchases: PastPurchase[] = [];
    const recent: PurchaseHistory['recent'] = [];
    for (const r of rows) {
      const { date } = localMinute(household.timezone, r.decided_at);
      const items = r.details.items ?? [];
      recent.push({
        at: r.decided_at.toISOString(),
        venue: r.details.venue ?? null,
        amount: typeof r.details.amount === 'number' ? r.details.amount : null,
        currency: r.details.currency ?? null,
        items,
      });
      for (const label of items) {
        purchases.push({
          action_id: r.id,
          person_id: r.person_id,
          label,
          venue: r.details.venue ?? null,
          amount: typeof r.details.amount === 'number' ? r.details.amount : null,
          local_date: date,
        });
      }
    }

    const repeats = mineRepurchases(purchases, await this.stated(household.id, speaker), {
      today,
      windowDays: WINDOW_DAYS,
    });
    const matches = filterFor(opts.item);
    return {
      recent: (matches ? recent.filter((r) => r.items.some(matches)) : recent).slice(0, opts.limit ?? 10),
      repeats: matches ? repeats.filter((r) => matches(r.label) || matches(r.item)) : repeats,
      due: repeats.filter((r) => r.due && (!matches || matches(r.label) || matches(r.item))),
    };
  }

  /** Cycles the person stated out loud ("I buy wet food every week"), read back off their own facts. */
  private async stated(householdId: string, speaker: Speaker | null): Promise<StatedCadence[]> {
    const { rows } = await this.db.query<{ id: string; content: string }>(
      `SELECT f.id, f.content FROM fact f
        WHERE f.household_id = $1 AND f.forgotten_at IS NULL AND f.valid_to IS NULL
          AND (f.ttl IS NULL OR f.valid_from + f.ttl > now())
          AND (f.scope_type = 'household' OR (f.scope_type = 'person' AND f.scope_id = $2::uuid))
        ORDER BY f.valid_from DESC LIMIT 500`,
      [householdId, speaker?.person_id ?? null],
    );
    const found: StatedCadence[] = [];
    for (const r of rows) {
      const said = statedCadence(r.content);
      // First mention wins: facts arrive newest first, and a newer statement supersedes an older one.
      if (said && !found.some((f) => f.item === said.item)) {
        found.push({ ...said, fact_id: r.id, text: r.content });
      }
    }
    return found;
  }
}

function filterFor(item?: string): ((label: string) => boolean) | null {
  const wanted = item?.trim().toLowerCase();
  if (!wanted) return null;
  return (label: string) => label.toLowerCase().includes(wanted) || wanted.includes(label.toLowerCase());
}
