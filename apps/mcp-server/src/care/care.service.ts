import { Inject, Injectable } from '@nestjs/common';
import {
  CARE_MODE_RULES,
  type CarePolicy,
  type CareStance,
  canEditCarePlan,
  detectRepeat,
  type Grant,
  keywordsFor,
  type MembershipRole,
  matchCarePolicies,
  mergeCarePolicies,
  type Repeat,
  sharedWith,
  temporalStamp,
} from '@recall/core';
import { Db } from '../db/db.js';
import type { Household, Speaker } from '../memory/memory.service.js';
import { SessionService, type SessionView } from '../sessions/session.service.js';

export interface CareBrief {
  mode: 'cared_for';
  rules: readonly string[];
  /** The policies this request touches. */
  policies: CarePolicy[];
  shared_with: string[];
}

export interface CareExtras {
  repeat?: Repeat;
  care?: CareBrief;
}

export interface CarePolicyInput {
  person: string;
  topic: string;
  keywords?: string[];
  policy: CareStance;
  guidance?: string;
  remove?: boolean;
}

export type SetCarePolicyResult =
  | { saved: true; removed?: boolean; person: string; policies: CarePolicy[]; message: string }
  | { saved: false; refused: 'unknown_speaker' | 'not_found' | 'not_cared_for' | 'not_allowed'; message: string };

interface MemberRow {
  person_id: string;
  display_name: string;
  role: MembershipRole;
  grants: Grant[];
}

const toMember = (m: MemberRow) => ({ person_id: m.person_id, role: m.role, grants: m.grants, capacity_flag: false });

/** Local midnight: "asked before today" looks this far back. */
function startOfLocalDay(timezone: string, now: Date): Date {
  const stamp = temporalStamp(timezone, now);
  return new Date(`${stamp.local_date}T00:00:00${stamp.utc_offset}`);
}

/** Care mode's additions to session_brief, and the caregiver's policies (design.md §5). */
@Injectable()
export class CareService {
  constructor(
    @Inject(Db) private readonly db: Db,
    @Inject(SessionService) private readonly sessions: SessionService,
  ) {}

  /**
   * A repeat flag for anyone (within the conversation; for a person in care, across the whole day),
   * and for a person in care, how to speak with them and what is shared.
   */
  async brief(
    household: Household,
    speaker: Speaker | null,
    hint: string | undefined,
    session: SessionView | null,
    now: Date = new Date(),
  ): Promise<CareExtras> {
    const text = hint?.trim() ?? '';
    const careMode = speaker?.role === 'cared_for';
    let repeat: Repeat | null = null;
    if (text) {
      const turns =
        careMode && speaker
          ? await this.sessions.turnsSince(household.id, speaker.person_id, startOfLocalDay(household.timezone, now))
          : (session?.turns ?? []);
      repeat = detectRepeat(text, turns, careMode ? 'cared_for' : 'normal');
    }
    if (!careMode || !speaker) return repeat ? { repeat } : {};

    const [policies, carers] = await Promise.all([
      this.policies(household.id, speaker.person_id),
      this.caregivers(household.id),
    ]);
    return {
      ...(repeat ? { repeat } : {}),
      care: {
        mode: 'cared_for',
        rules: CARE_MODE_RULES,
        policies: matchCarePolicies(text, policies),
        shared_with: sharedWith(carers),
      },
    };
  }

  /** Only a caregiver with the care-plan grant, or the household owner, sets how a topic is handled. */
  async setPolicy(household: Household, actor: Speaker | null, input: CarePolicyInput): Promise<SetCarePolicyResult> {
    if (!actor) return { saved: false, refused: 'unknown_speaker', message: 'Ask who is speaking first.' };
    const [subject, me] = await Promise.all([
      this.member(household.id, input.person),
      this.member(household.id, actor.person_id),
    ]);
    if (!subject) return { saved: false, refused: 'not_found', message: `No one called ${input.person} here.` };
    if (subject.role !== 'cared_for') {
      return {
        saved: false,
        refused: 'not_cared_for',
        message: `${subject.display_name} isn't being cared for here; care policies are only for someone who is.`,
      };
    }
    if (actor.role !== 'owner' && !(me && canEditCarePlan(toMember(me), toMember(subject)))) {
      return {
        saved: false,
        refused: 'not_allowed',
        message: 'Only a caregiver with the care-plan grant, or the household owner, can set this.',
      };
    }

    const topic = input.topic.trim();
    const given = (input.keywords ?? []).map((k) => k.trim()).filter(Boolean);
    const keywords = given.length > 0 ? given : keywordsFor(topic);
    await this.db.transaction(async (tx) => {
      await tx.query(
        `UPDATE care_policy SET removed_at = now()
          WHERE household_id = $1 AND person_id = $2 AND lower(topic) = lower($3) AND removed_at IS NULL`,
        [household.id, subject.person_id, topic],
      );
      if (input.remove) return;
      await tx.query(
        `INSERT INTO care_policy (household_id, region, person_id, topic, keywords, policy, guidance, author_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          household.id,
          household.region,
          subject.person_id,
          topic,
          keywords,
          input.policy,
          input.guidance?.trim() || null,
          actor.person_id,
        ],
      );
    });
    return {
      saved: true,
      ...(input.remove ? { removed: true } : {}),
      person: subject.display_name,
      policies: await this.policies(household.id, subject.person_id),
      message: input.remove
        ? `Removed the policy on “${topic}” for ${subject.display_name}.`
        : `Saved: ${input.policy} on “${topic}” for ${subject.display_name}.`,
    };
  }

  private async policies(householdId: string, personId: string): Promise<CarePolicy[]> {
    const { rows } = await this.db.query<Omit<CarePolicy, 'set_by'>>(
      `SELECT topic, keywords, policy, guidance FROM care_policy
        WHERE household_id = $1 AND person_id = $2 AND removed_at IS NULL ORDER BY created_at`,
      [householdId, personId],
    );
    return mergeCarePolicies(rows.map((r) => ({ ...r, set_by: 'caregiver' as const })));
  }

  private async caregivers(householdId: string): Promise<{ name: string; grants: Grant[] }[]> {
    const { rows } = await this.db.query<{ name: string; grants: Grant[] }>(
      `SELECT p.display_name AS name, m.grants::text[] AS grants
         FROM membership m JOIN person p ON p.id = m.person_id
        WHERE m.household_id = $1 AND m.role = 'caregiver' AND m.revoked_at IS NULL
        ORDER BY p.display_name`,
      [householdId],
    );
    return rows;
  }

  private async member(householdId: string, who: string): Promise<MemberRow | null> {
    const { rows } = await this.db.query<MemberRow>(
      `SELECT p.id AS person_id, p.display_name, m.role, m.grants::text[] AS grants
         FROM membership m JOIN person p ON p.id = m.person_id
        WHERE m.household_id = $1 AND m.revoked_at IS NULL
          AND (p.id::text = $2 OR lower(p.display_name) = lower($2))
        LIMIT 2`,
      [householdId, who.trim()],
    );
    return rows.length === 1 ? (rows[0] ?? null) : null;
  }
}
