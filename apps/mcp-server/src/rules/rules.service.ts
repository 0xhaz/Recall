import { Inject, Injectable } from '@nestjs/common';
import {
  canSetRulesFor,
  findConflicts,
  type Member,
  type RuleSeverity,
  type RuleView,
  resolveEnd,
  summarizeRule,
  temporalStamp,
} from '@recall/core';
import { Db, type Queryable } from '../db/db.js';
import { EventLog, lockHousehold } from '../events/event-log.service.js';
import { MembershipService } from '../households/membership.service.js';
import { UsageMeter } from '../llm/usage-meter.js';
import { Eraser } from '../memory/eraser.js';
import type { Household, Speaker } from '../memory/memory.service.js';
import { ParsedRule, RULE_SCHEMA, ruleMessages, structureRule } from './parse.js';

export interface RuleSummary {
  id: string;
  text: string;
  summary: string;
  effect: string;
  severity: string;
  applies_to: string;
  author: string | null;
  created_at: string;
  expires_at: string | null;
}

export type SetRuleResult =
  | { saved: true; rule: RuleSummary; conflicts: RuleSummary[]; message: string }
  | {
      saved: false;
      refused: 'unknown_speaker' | 'not_allowed' | 'unclear' | 'unknown_target' | 'unavailable';
      message: string;
    };

export type RemoveRuleResult =
  | { removed: true; rule: RuleSummary; message: string }
  | { removed: false; refused: 'unknown_speaker' | 'not_allowed' | 'not_found'; message: string };

interface Target {
  scope_type: 'person' | 'household' | 'device';
  scope_id: string;
  subject: Member | null;
}

interface RuleRow {
  view: RuleView;
  author_name: string | null;
  subject_name: string | null;
}

const HOUSEHOLD_WORDS = new Set([
  'household',
  'everyone',
  'everybody',
  'the house',
  'house',
  'home',
  'us',
  'we',
  'family',
]);
const IN_FORCE = 'r.removed_at IS NULL AND (r.expires_at IS NULL OR r.expires_at > now())';

/** Stated rules (architecture.md §1.5): stored verbatim with a structured form, law rather than evidence. */
@Injectable()
export class RulesService {
  constructor(
    @Inject(Db) private readonly db: Db,
    @Inject(EventLog) private readonly events: EventLog,
    @Inject(Eraser) private readonly eraser: Eraser,
    @Inject(UsageMeter) private readonly meter: UsageMeter,
    @Inject(MembershipService) private readonly memberships: MembershipService,
  ) {}

  async set(
    household: Household,
    speaker: Speaker | null,
    text: string,
    opts: { appliesTo?: string; severity?: RuleSeverity; structured?: ParsedRule; deviceId?: string } = {},
  ): Promise<SetRuleResult> {
    if (!speaker) {
      return { saved: false, refused: 'unknown_speaker', message: 'Ask who is speaking before saving a rule.' };
    }
    if (speaker.role === 'guest') {
      return { saved: false, refused: 'not_allowed', message: "Guests can't set rules for this household." };
    }

    let parsed: ParsedRule;
    try {
      parsed = opts.structured ?? (await this.parse(household, speaker, text));
    } catch {
      return {
        saved: false,
        refused: 'unavailable',
        message: "I couldn't save that rule just now. Try again in a moment.",
      };
    }
    const structured = structureRule(parsed);
    if ('error' in structured) return { saved: false, refused: 'unclear', message: structured.error };

    const appliesTo = opts.appliesTo ?? structured.applies_to;
    const target = await this.resolveTarget(household.id, speaker, appliesTo, opts.deviceId);
    if (!target) {
      return {
        saved: false,
        refused: 'unknown_target',
        message: `I don't know who "${appliesTo}" is in this household.`,
      };
    }
    const actor = await this.memberships.member(household.id, speaker.person_id);
    if (!actor || !canSet(actor, target)) {
      return {
        saved: false,
        refused: 'not_allowed',
        message: 'Household rules need an adult; a rule for someone else needs their parent or caregiver.',
      };
    }
    // Safety rules outrank the person's own wishes, so only a caregiver can make one, for the person they care for.
    const severity: RuleSeverity =
      opts.severity === 'safety' && actor.role === 'caregiver' && target.subject?.role === 'cared_for'
        ? 'safety'
        : opts.severity === 'soft'
          ? 'soft'
          : 'hard';
    const expiresOn = resolveEnd(structured.ends, temporalStamp(household.timezone).local_date);

    const saved = await this.db.transaction(async (tx) => {
      await lockHousehold(tx, household.id);
      const { rows } = await tx.query<{ id: string }>(
        `INSERT INTO rule (household_id, region, author_id, author_role, scope_type, scope_id, text, effect, severity,
                           subject, condition, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
                 CASE WHEN $12::date IS NULL THEN NULL ELSE ($12::date + 1)::timestamp AT TIME ZONE $13 END)
         RETURNING id`,
        [
          household.id,
          household.region,
          speaker.person_id,
          actor.role,
          target.scope_type,
          target.scope_id,
          text.trim(),
          structured.effect,
          severity,
          JSON.stringify(structured.subject),
          JSON.stringify(structured.condition),
          expiresOn,
          household.timezone,
        ],
      );
      const id = rows[0]?.id;
      if (!id) throw new Error('Rule insert returned no id');
      await this.events.ruleChanged(tx, id, 'rule.set');
      return (await this.rows(tx, household.id, 'r.id = $2', [id]))[0];
    });
    if (!saved) throw new Error('Saved rule not found');

    const others = await this.rows(this.db, household.id, `${IN_FORCE} AND r.id <> $2`, [saved.view.id]);
    const byId = new Map(others.map((o) => [o.view.id, o]));
    const conflicts = findConflicts(
      saved.view,
      others.map((o) => o.view),
    ).flatMap((c) => {
      const row = byId.get(c.id);
      return row ? [summary(row)] : [];
    });

    const rule = summary(saved);
    const downgraded =
      opts.severity === 'safety' && severity !== 'safety'
        ? ' Only a caregiver can make a safety rule, so it was saved as an ordinary one.'
        : '';
    const clash = conflicts.length
      ? ` It pulls the other way from ${conflicts.map((c) => `“${c.text}”`).join(', ')}: tell the person; nothing was changed.`
      : '';
    return {
      saved: true,
      rule,
      conflicts,
      message: `Rule saved: “${rule.text}” (${rule.summary}).${downgraded}${clash}`,
    };
  }

  /** Rules the speaker can see: household and device rules, and person rules about or by them. */
  async list(householdId: string, speaker: Speaker | null): Promise<RuleSummary[]> {
    const rows = await this.rows(
      this.db,
      householdId,
      `${IN_FORCE} AND (r.scope_type <> 'person' OR r.scope_id = $2 OR r.author_id::text = $2)`,
      [speaker?.person_id ?? ''],
    );
    return rows.map(summary);
  }

  /** What binds a request from this person on this device, for session_brief. */
  async applicable(householdId: string, personId: string | null, deviceId?: string): Promise<RuleSummary[]> {
    const rows = await this.rows(
      this.db,
      householdId,
      `${IN_FORCE} AND (r.scope_type = 'household'
                         OR (r.scope_type = 'person' AND r.scope_id = $2)
                         OR (r.scope_type = 'device' AND r.scope_id = $3))`,
      [personId ?? '', deviceId ?? ''],
    );
    return rows.map(summary);
  }

  /** Every rule in force, for evaluating actions. */
  async inForce(householdId: string): Promise<RuleView[]> {
    return (await this.rows(this.db, householdId, IN_FORCE, [])).map((r) => r.view);
  }

  /** Only a rule's author can remove it, or a caregiver for the person they care for. */
  async remove(householdId: string, speaker: Speaker | null, ruleId: string): Promise<RemoveRuleResult> {
    if (!speaker) {
      return { removed: false, refused: 'unknown_speaker', message: 'Ask who is speaking before removing a rule.' };
    }
    const [row] = await this.rows(this.db, householdId, 'r.id = $2 AND r.removed_at IS NULL', [ruleId]);
    if (!row) return { removed: false, refused: 'not_found', message: 'There is no such rule.' };

    let allowed = row.view.author_id === speaker.person_id;
    if (!allowed && row.view.scope_type === 'person') {
      const [actor, subject] = await Promise.all([
        this.memberships.member(householdId, speaker.person_id),
        this.memberships.member(householdId, row.view.scope_id),
      ]);
      allowed = actor?.role === 'caregiver' && subject?.role === 'cared_for' && actor.grants.includes('set_rules');
    }
    if (!allowed) {
      return { removed: false, refused: 'not_allowed', message: 'Only the person who set a rule can remove it.' };
    }

    await this.db.transaction(async (tx) => {
      await lockHousehold(tx, householdId);
      await this.eraser.removeRules(tx, householdId, [ruleId], speaker.person_id);
    });
    const rule = summary(row);
    return { removed: true, rule, message: `Rule removed: “${rule.text}”.` };
  }

  private async parse(household: Household, speaker: Speaker, text: string): Promise<ParsedRule> {
    const reply = await this.meter.chat({ householdId: household.id, region: household.region }, 'rule_parse', {
      messages: ruleMessages({ speaker: speaker.display_name, text, timezone: household.timezone, now: new Date() }),
      jsonSchema: RULE_SCHEMA,
    });
    return ParsedRule.parse(JSON.parse(reply.text));
  }

  private async resolveTarget(
    householdId: string,
    speaker: Speaker,
    appliesTo: string,
    deviceId?: string,
  ): Promise<Target | null> {
    const wanted = appliesTo.trim().toLowerCase();
    if (!wanted || ['me', 'myself', speaker.display_name.toLowerCase(), speaker.person_id].includes(wanted)) {
      const self = await this.memberships.member(householdId, speaker.person_id);
      return { scope_type: 'person', scope_id: speaker.person_id, subject: self };
    }
    if (HOUSEHOLD_WORDS.has(wanted)) return { scope_type: 'household', scope_id: householdId, subject: null };
    if ((wanted === 'this device' || wanted === 'device') && deviceId) {
      return { scope_type: 'device', scope_id: deviceId, subject: null };
    }
    const { rows: devices } = await this.db.query<{ device_id: string }>(
      'SELECT device_id FROM device WHERE household_id = $1 AND lower(device_id) = $2',
      [householdId, wanted],
    );
    if (devices[0]) return { scope_type: 'device', scope_id: devices[0].device_id, subject: null };

    const { rows: people } = await this.db.query<{ person_id: string }>(
      `SELECT p.id AS person_id FROM membership m JOIN person p ON p.id = m.person_id
        WHERE m.household_id = $1 AND m.revoked_at IS NULL AND (p.id::text = $2 OR lower(p.display_name) = $2)
        LIMIT 2`,
      [householdId, wanted],
    );
    const [person] = people;
    if (!person || people.length > 1) return null;
    return {
      scope_type: 'person',
      scope_id: person.person_id,
      subject: await this.memberships.member(householdId, person.person_id),
    };
  }

  private async rows(q: Queryable, householdId: string, where: string, params: unknown[]): Promise<RuleRow[]> {
    const { rows } = await q.query<RuleRow>(
      `SELECT v.view, a.display_name AS author_name, s.display_name AS subject_name
         FROM rule r
         JOIN rule_view v ON v.id = r.id
         LEFT JOIN person a ON a.id = r.author_id
         LEFT JOIN person s ON r.scope_type = 'person' AND s.id::text = r.scope_id
        WHERE r.household_id = $1 AND ${where}
        ORDER BY r.created_at`,
      [householdId, ...params],
    );
    return rows;
  }
}

function canSet(actor: Member, target: Target): boolean {
  if (target.scope_type !== 'person') return actor.role === 'owner' || actor.role === 'adult';
  return !!target.subject && canSetRulesFor(actor, target.subject);
}

function summary(row: RuleRow): RuleSummary {
  const r = row.view;
  const who =
    r.scope_type === 'household'
      ? 'household'
      : r.scope_type === 'device'
        ? `on ${r.scope_id}`
        : `for ${row.subject_name ?? 'someone who has left'}`;
  return {
    id: r.id,
    text: r.text,
    summary: summarizeRule(r, who),
    effect: r.effect,
    severity: r.severity,
    applies_to: who,
    author: row.author_name,
    created_at: r.created_at,
    expires_at: r.expires_at,
  };
}
