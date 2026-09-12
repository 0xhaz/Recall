import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  type CarePolicy,
  canDeletePersonMemory,
  canEditCarePlan,
  canEnterFactsFor,
  canReadPersonMemory,
  canViewDaily,
  type Member,
  mergeCarePolicies,
  type SensitivityTag,
  screen,
  tagsFor,
} from '@recall/core';
import { ActionService } from '../actions/action.service.js';
import { audit } from '../audit.js';
import { type CarePolicyInput, CareService } from '../care/care.service.js';
import { ContextService } from '../context/context.service.js';
import { Db } from '../db/db.js';
import { EventLog, lockHousehold } from '../events/event-log.service.js';
import { enqueue } from '../jobs/queue.js';
import { Eraser } from '../memory/eraser.js';
import type { Household, Speaker } from '../memory/memory.service.js';
import { RulesService } from '../rules/rules.service.js';

// The console is the surface where memory becomes legible and controllable (design.md §6). Every
// read is scoped by the same access rules as the voice path, and every change goes through the
// same event log, so a fact corrected here reaches devices exactly as a spoken correction would.

const PAGE = 50;
const MAX_PAGE = 200;

export type FactState = 'current' | 'superseded' | 'forgotten' | 'all';

export interface FactFilters {
  person?: string;
  query?: string;
  state?: FactState;
  limit?: number;
  offset?: number;
}

export interface ConsoleFact {
  id: string;
  content: string;
  scope: string;
  scope_name: string | null;
  type: string;
  confidence: number;
  sensitivity: SensitivityTag;
  source: Record<string, unknown>;
  said_by: string | null;
  valid_from: string;
  valid_to: string | null;
  expires_at: string | null;
  forgotten_at: string | null;
  superseded_by: string | null;
  editable: boolean;
  deletable: boolean;
}

interface FactRow {
  id: string;
  content: string;
  scope_type: string;
  scope_id: string;
  type: string;
  confidence: number;
  sensitivity_tag: SensitivityTag;
  source: Record<string, unknown>;
  said_by: string | null;
  scope_name: string | null;
  valid_from: Date;
  valid_to: Date | null;
  expires_at: Date | null;
  forgotten_at: Date | null;
  superseded_by: string | null;
}

const iso = (d: Date | null) => d?.toISOString() ?? null;

/** Everything the console reads and writes, under the signed-in person's own permissions. */
@Injectable()
export class ConsoleService {
  constructor(
    @Inject(Db) private readonly db: Db,
    @Inject(EventLog) private readonly events: EventLog,
    @Inject(Eraser) private readonly eraser: Eraser,
    @Inject(RulesService) private readonly rules: RulesService,
    @Inject(ActionService) private readonly actionService: ActionService,
    @Inject(ContextService) private readonly contexts: ContextService,
    @Inject(CareService) private readonly care: CareService,
  ) {}

  // ---------------------------------------------------------------- who is asking

  /** Membership is the gate: no row, no household. */
  async requireMember(householdId: string, personId: string): Promise<Member> {
    const { rows } = await this.db.query<Member>(
      `SELECT person_id, role, grants::text[] AS grants, capacity_flag FROM membership
        WHERE household_id = $1 AND person_id = $2 AND revoked_at IS NULL`,
      [householdId, personId],
    );
    const member = rows[0];
    if (!member) throw new ForbiddenException('Not a member of this household');
    return member;
  }

  private async household(householdId: string): Promise<Household> {
    const { rows } = await this.db.query<Household>('SELECT id, name, region, timezone FROM household WHERE id = $1', [
      householdId,
    ]);
    const household = rows[0];
    if (!household) throw new NotFoundException('No such household');
    return household;
  }

  /** Services shared with the voice path speak in Speakers; the console caller is one, fully trusted. */
  private async speaker(householdId: string, personId: string): Promise<Speaker> {
    const { rows } = await this.db.query<Omit<Speaker, 'confidence'>>(
      `SELECT p.id AS person_id, p.display_name, m.role
         FROM membership m JOIN person p ON p.id = m.person_id
        WHERE m.household_id = $1 AND m.person_id = $2 AND m.revoked_at IS NULL`,
      [householdId, personId],
    );
    const speaker = rows[0];
    if (!speaker) throw new ForbiddenException('Not a member of this household');
    return { ...speaker, confidence: 1 };
  }

  private async members(householdId: string): Promise<(Member & { display_name: string })[]> {
    const { rows } = await this.db.query<Member & { display_name: string }>(
      `SELECT m.person_id, m.role, m.grants::text[] AS grants, m.capacity_flag, p.display_name
         FROM membership m JOIN person p ON p.id = m.person_id
        WHERE m.household_id = $1 AND m.revoked_at IS NULL
        ORDER BY p.display_name`,
      [householdId],
    );
    return rows;
  }

  /** Whose person-scoped memory this member may read: their own, a child's, a cared-for person's. */
  private async readable(householdId: string, actor: Member): Promise<string[]> {
    const all = await this.members(householdId);
    return all.filter((subject) => canReadPersonMemory(actor, subject)).map((m) => m.person_id);
  }

  // ---------------------------------------------------------------- memory browser

  async facts(householdId: string, personId: string, filters: FactFilters): Promise<ConsoleFact[]> {
    const actor = await this.requireMember(householdId, personId);
    const readable = await this.readable(householdId, actor);
    const all = await this.members(householdId);
    const limit = Math.min(filters.limit ?? PAGE, MAX_PAGE);

    const { rows } = await this.db.query<FactRow>(
      `SELECT f.id, f.content, f.scope_type, f.scope_id::text AS scope_id, f.type, f.confidence, f.sensitivity_tag,
              f.source, f.valid_from, f.valid_to, f.valid_from + f.ttl AS expires_at, f.forgotten_at,
              f.superseded_by::text AS superseded_by, scope.display_name AS scope_name, said.display_name AS said_by
         FROM fact f
         LEFT JOIN person scope ON f.scope_type = 'person' AND scope.id = f.scope_id
         LEFT JOIN person said ON said.id::text = f.source->>'speaker_id'
        WHERE f.household_id = $1
          AND (f.scope_type = 'household' OR f.scope_id = ANY($2::uuid[]))
          AND ($3::text IS NULL OR f.content ILIKE '%' || $3 || '%')
          AND ($4::uuid IS NULL OR (f.scope_type = 'person' AND f.scope_id = $4))
          AND CASE $5::text
                WHEN 'current' THEN f.valid_to IS NULL AND f.forgotten_at IS NULL
                WHEN 'superseded' THEN f.valid_to IS NOT NULL AND f.forgotten_at IS NULL
                WHEN 'forgotten' THEN f.forgotten_at IS NOT NULL
                ELSE true
              END
        ORDER BY f.valid_from DESC
        LIMIT $6 OFFSET $7`,
      [
        householdId,
        readable,
        filters.query?.trim() || null,
        filters.person ?? null,
        filters.state ?? 'current',
        limit,
        Math.max(filters.offset ?? 0, 0),
      ],
    );

    return rows.map((r) => ({
      id: r.id,
      content: r.content,
      scope: r.scope_type,
      scope_name: r.scope_type === 'household' ? 'Household' : r.scope_name,
      type: r.type,
      confidence: r.confidence,
      sensitivity: r.sensitivity_tag,
      source: r.source,
      said_by: r.said_by,
      valid_from: r.valid_from.toISOString(),
      valid_to: iso(r.valid_to),
      expires_at: iso(r.expires_at),
      forgotten_at: iso(r.forgotten_at),
      superseded_by: r.superseded_by,
      editable: this.mayEdit(actor, all, r.scope_type, r.scope_id),
      deletable: this.mayDelete(actor, all, r.scope_type, r.scope_id),
    }));
  }

  /** Household facts: anyone but a guest. Person facts: the person, a parent, a caregiver who may enter facts. */
  private mayEdit(actor: Member, all: Member[], scopeType: string, scopeId: string): boolean {
    if (scopeType === 'household') return actor.role !== 'guest';
    const subject = all.find((m) => m.person_id === scopeId);
    return !!subject && canEnterFactsFor(actor, subject);
  }

  /** Erasing is a wider right than rewriting: a parent may delete a child's memory, not reword it. */
  private mayDelete(actor: Member, all: Member[], scopeType: string, scopeId: string): boolean {
    if (scopeType === 'household') return actor.role !== 'guest';
    const subject = all.find((m) => m.person_id === scopeId);
    return !!subject && canDeletePersonMemory(actor, subject);
  }

  /**
   * Fixing a wrong fact (the console's first must-show moment): the old one is closed and linked,
   * never overwritten, and the new one is announced to every device.
   */
  async correctFact(
    householdId: string,
    personId: string,
    factId: string,
    content: string,
  ): Promise<{ corrected: string; content: string; redacted: string[] }> {
    const actor = await this.requireMember(householdId, personId);
    const all = await this.members(householdId);
    // The same write-time screen as the voice path: a correction can't smuggle in a card number.
    const screened = screen(content);
    if (!screened.text) throw new BadRequestException(`Not stored: ${screened.redactions.join(', ')}`);

    return this.db.transaction(async (tx) => {
      await lockHousehold(tx, householdId);
      const { rows } = await tx.query<{ scope_type: string; scope_id: string }>(
        `SELECT scope_type, scope_id::text AS scope_id FROM fact
          WHERE household_id = $1 AND id = $2 AND forgotten_at IS NULL AND valid_to IS NULL`,
        [householdId, factId],
      );
      const fact = rows[0];
      if (!fact) throw new NotFoundException('No such fact, or it is no longer current');
      if (!this.mayEdit(actor, all, fact.scope_type, fact.scope_id)) {
        throw new ForbiddenException('Not yours to change');
      }

      const { rows: created } = await tx.query<{ id: string }>(
        `INSERT INTO fact (household_id, region, scope_type, scope_id, type, content, entities, source, confidence,
                           sensitivity_tag, ttl)
         SELECT household_id, region, scope_type, scope_id, type, $3::text, '[]'::jsonb,
                jsonb_build_object('origin', 'console', 'entered_by', $4::text, 'corrected_from', id::text),
                0.95, $5::text, ttl
           FROM fact WHERE id = $2 AND household_id = $1
         RETURNING id`,
        [householdId, factId, screened.text, personId, tagsFor(screened.text)[0] ?? 'none'],
      );
      const replacement = created[0]?.id;
      if (!replacement) throw new NotFoundException('No such fact');

      await tx.query('UPDATE fact SET valid_to = now(), superseded_by = $2 WHERE id = $1', [factId, replacement]);
      await this.events.factCreated(tx, replacement);
      await this.events.factChanged(tx, factId, 'fact.superseded', { superseded_by: replacement, by: personId });
      // Searchable by meaning only once it has an embedding; the worker fills it in.
      await enqueue(tx, householdId, 'embed', {});
      await audit(tx, {
        householdId,
        actorId: personId,
        action: 'console.fact_corrected',
        targetType: 'fact',
        targetId: factId,
        detail: { replacement },
      });
      return { corrected: replacement, content: screened.text, redacted: screened.redactions };
    });
  }

  /** Marking a fact wrong is forgetting it: the same tombstone the voice "forget" writes. */
  async forgetFact(householdId: string, personId: string, factId: string): Promise<{ forgotten: string[] }> {
    const actor = await this.requireMember(householdId, personId);
    const all = await this.members(householdId);
    return this.db.transaction(async (tx) => {
      await lockHousehold(tx, householdId);
      const { rows } = await tx.query<{ scope_type: string; scope_id: string }>(
        `SELECT scope_type, scope_id::text AS scope_id FROM fact
          WHERE household_id = $1 AND id = $2 AND forgotten_at IS NULL`,
        [householdId, factId],
      );
      const fact = rows[0];
      if (!fact) throw new NotFoundException('No such fact');
      const subject = all.find((m) => m.person_id === fact.scope_id);
      const allowed =
        fact.scope_type === 'household' ? actor.role !== 'guest' : !!subject && canDeletePersonMemory(actor, subject);
      if (!allowed) throw new ForbiddenException('Not yours to delete');

      const forgotten = await this.eraser.forgetFacts(tx, householdId, [factId], personId);
      await audit(tx, {
        householdId,
        actorId: personId,
        action: 'console.fact_forgotten',
        targetType: 'fact',
        targetId: factId,
        detail: { count: forgotten.length },
      });
      return { forgotten };
    });
  }

  // ---------------------------------------------------------------- rules, routines, actions

  async rulesFor(householdId: string, personId: string) {
    await this.requireMember(householdId, personId);
    const speaker = await this.speaker(householdId, personId);
    const [inForce, blocked] = await Promise.all([
      this.rules.list(householdId, speaker),
      this.blockedActions(householdId),
    ]);
    return { rules: inForce, blocked };
  }

  /** The log of what a rule stopped: the console's second must-show moment. */
  private async blockedActions(householdId: string) {
    const { rows } = await this.db.query<{
      id: string;
      summary: string;
      intent: string;
      created_at: Date;
      preflight: { blocked_by?: { rule_id: string; text: string } | null; withheld?: { reason: string } | null };
      person: string | null;
    }>(
      `SELECT a.id, a.summary, a.intent, a.created_at, a.preflight, p.display_name AS person
         FROM action a LEFT JOIN person p ON p.id = a.person_id
        WHERE a.household_id = $1 AND a.status = 'blocked'
        ORDER BY a.created_at DESC LIMIT 20`,
      [householdId],
    );
    return rows.map((r) => ({
      action_id: r.id,
      summary: r.summary,
      intent: r.intent,
      person: r.person,
      at: r.created_at.toISOString(),
      rule: r.preflight.blocked_by ?? null,
      withheld: r.preflight.withheld ?? null,
    }));
  }

  async removeRule(householdId: string, personId: string, ruleId: string) {
    await this.requireMember(householdId, personId);
    return this.rules.remove(householdId, await this.speaker(householdId, personId), ruleId);
  }

  async routines(householdId: string, personId: string) {
    const actor = await this.requireMember(householdId, personId);
    const readable = await this.readable(householdId, actor);
    const { rows } = await this.db.query<{
      id: string;
      person: string | null;
      kind: string;
      days: string;
      center_minute: number;
      spread_minutes: number;
      shifted_from: number | null;
      support: number;
      confidence: number;
      last_seen: Date | null;
      sequence: string[];
      status: string;
      health: string;
      health_reason: string | null;
      accepted: number;
      dismissed: number;
    }>(
      `SELECT r.id, p.display_name AS person, r.kind, r.days, r.center_minute, r.spread_minutes, r.shifted_from,
              r.support, r.confidence, r.last_seen, r.sequence, r.status, r.health, r.health_reason,
              r.accepted, r.dismissed
         FROM routine r LEFT JOIN person p ON p.id = r.person_id
        WHERE r.household_id = $1 AND (r.person_id IS NULL OR r.person_id = ANY($2::uuid[]))
        ORDER BY r.status, r.center_minute`,
      [householdId, readable],
    );
    return rows.map((r) => ({ ...r, last_seen: r.last_seen ? r.last_seen.toISOString().slice(0, 10) : null }));
  }

  /** Accepting a candidate makes it active; dismissing retires it and counts against re-offering. */
  async decideRoutine(householdId: string, personId: string, routineId: string, decision: 'accept' | 'dismiss') {
    const actor = await this.requireMember(householdId, personId);
    if (actor.role === 'guest') throw new ForbiddenException('Guests cannot change routines');
    const { rows } = await this.db.query<{ id: string; status: string }>(
      decision === 'accept'
        ? `UPDATE routine SET status = 'active', accepted = accepted + 1, updated_at = now()
            WHERE household_id = $1 AND id = $2 RETURNING id, status`
        : `UPDATE routine SET status = 'retired', dismissed = dismissed + 1, updated_at = now()
            WHERE household_id = $1 AND id = $2 RETURNING id, status`,
      [householdId, routineId],
    );
    const routine = rows[0];
    if (!routine) throw new NotFoundException('No such routine');
    return routine;
  }

  /** Everything done on the household's behalf, with what pre-flight asked and whether undo is still open. */
  async actions(householdId: string, personId: string, limit = 30) {
    await this.requireMember(householdId, personId);
    const { rows } = await this.db.query<{
      id: string;
      person: string | null;
      intent: string;
      summary: string;
      status: string;
      tier: string;
      proactive: boolean;
      source: unknown;
      preflight: { decision?: string; confirm?: { message: string }[]; blocked_by?: { text: string } | null };
      created_at: Date;
      decided_at: Date | null;
      undo_until: Date | null;
      undone_at: Date | null;
    }>(
      `SELECT a.id, p.display_name AS person, a.intent, a.summary, a.status, a.tier, a.proactive, a.source,
              a.preflight, a.created_at, a.decided_at, a.undo_until, a.undone_at
         FROM action a LEFT JOIN person p ON p.id = a.person_id
        WHERE a.household_id = $1
        ORDER BY a.created_at DESC LIMIT $2`,
      [householdId, Math.min(limit, MAX_PAGE)],
    );
    const now = Date.now();
    return rows.map((r) => ({
      id: r.id,
      person: r.person,
      intent: r.intent,
      summary: r.summary,
      status: r.status,
      tier: r.tier,
      proactive: r.proactive,
      source: r.source,
      decision: r.preflight.decision ?? null,
      confirmed: r.preflight.confirm?.map((c) => c.message) ?? [],
      blocked_by: r.preflight.blocked_by ?? null,
      at: r.created_at.toISOString(),
      decided_at: iso(r.decided_at),
      undo_until: iso(r.undo_until),
      undoable: r.status === 'executed' && !!r.undo_until && r.undo_until.getTime() > now,
    }));
  }

  async undoAction(householdId: string, personId: string, actionId: string) {
    await this.requireMember(householdId, personId);
    const [household, speaker] = await Promise.all([this.household(householdId), this.speaker(householdId, personId)]);
    return this.actionService.undo(household, speaker, actionId);
  }

  // ---------------------------------------------------------------- context, devices, people

  async context(householdId: string, personId: string) {
    const actor = await this.requireMember(householdId, personId);
    const readable = await this.readable(householdId, actor);
    const reading = await this.contexts.read(householdId, personId);
    const { rows: baselines } = await this.db.query<{
      person: string;
      resting_hr: number | null;
      ratio: number | null;
    }>(
      `SELECT p.display_name AS person, b.resting_hr, b.workout_ratio AS ratio
         FROM context_baseline b JOIN person p ON p.id = b.person_id
        WHERE b.household_id = $1 AND b.person_id = ANY($2::uuid[])`,
      [householdId, readable],
    );
    return { ...reading, thresholds: baselines };
  }

  async devices(householdId: string, personId: string) {
    await this.requireMember(householdId, personId);
    const { rows } = await this.db.query<{
      device_id: string;
      name: string | null;
      location: string | null;
      primary_person: string | null;
      first_seen_at: Date;
      last_seen_at: Date;
      last_cursor: string;
      state: unknown;
    }>(
      `SELECT d.device_id, d.name, d.location, p.display_name AS primary_person, d.first_seen_at, d.last_seen_at,
              d.last_cursor, d.state
         FROM device d LEFT JOIN person p ON p.id = d.primary_person_id
        WHERE d.household_id = $1
        ORDER BY d.last_seen_at DESC`,
      [householdId],
    );
    return rows.map((d) => ({
      ...d,
      first_seen_at: d.first_seen_at.toISOString(),
      last_seen_at: d.last_seen_at.toISOString(),
      last_cursor: Number(d.last_cursor),
    }));
  }

  /** Who is in the household and what each of them can see, said plainly. */
  async people(householdId: string, personId: string) {
    await this.requireMember(householdId, personId);
    const all = await this.members(householdId);
    return all.map((m) => ({
      person_id: m.person_id,
      name: m.display_name,
      role: m.role,
      grants: m.grants,
      capacity_flag: m.capacity_flag,
      sees: m.role === 'guest' ? 'Nothing is stored for guests' : 'Household memory, and their own',
    }));
  }

  async notices(householdId: string, personId: string, limit = 30) {
    await this.requireMember(householdId, personId);
    const { rows } = await this.db.query<{
      id: string;
      kind: string;
      audience: string;
      text: string;
      person: string | null;
      device_id: string | null;
      created_at: Date;
      acknowledged_at: Date | null;
    }>(
      `SELECT n.id, n.kind, n.audience, n.text, p.display_name AS person, n.device_id, n.created_at, n.acknowledged_at
         FROM notice n LEFT JOIN person p ON p.id = n.person_id
        WHERE n.household_id = $1
        ORDER BY n.created_at DESC LIMIT $2`,
      [householdId, Math.min(limit, MAX_PAGE)],
    );
    return rows.map((n) => ({
      ...n,
      created_at: n.created_at.toISOString(),
      acknowledged_at: iso(n.acknowledged_at),
    }));
  }

  // ---------------------------------------------------------------- care mode

  async carePlan(householdId: string, personId: string, subjectId: string) {
    const actor = await this.requireMember(householdId, personId);
    const all = await this.members(householdId);
    const subject = all.find((m) => m.person_id === subjectId);
    if (subject?.role !== 'cared_for') throw new NotFoundException('Nobody is being cared for here');
    // The caregiver's own view: their grants are what open it, not full access to the person's memory.
    const maySee =
      canEditCarePlan(actor, subject) ||
      canViewDaily(actor, subject) ||
      canReadPersonMemory(actor, subject) ||
      actor.role === 'owner' ||
      actor.role === 'adult';
    if (!maySee) throw new ForbiddenException('Not yours to see');

    const [policies, day, alerts] = await Promise.all([
      this.db.query<Omit<CarePolicy, 'set_by'>>(
        `SELECT topic, keywords, policy, guidance FROM care_policy
          WHERE household_id = $1 AND person_id = $2 AND removed_at IS NULL ORDER BY created_at`,
        [householdId, subjectId],
      ),
      this.db.query<{ kind: string; at: Date; ok: boolean }>(
        `SELECT kind, at, ok FROM activity
          WHERE household_id = $1 AND person_id = $2 AND at > now() - interval '36 hours'
          ORDER BY at DESC LIMIT 50`,
        [householdId, subjectId],
      ),
      this.db.query<{ kind: string; text: string; created_at: Date; acknowledged_at: Date | null }>(
        `SELECT kind, text, created_at, acknowledged_at FROM notice
          WHERE household_id = $1 AND (person_id = $2 OR audience = 'carers')
            AND created_at > now() - interval '7 days'
          ORDER BY created_at DESC LIMIT 30`,
        [householdId, subjectId],
      ),
    ]);

    return {
      person: { id: subject.person_id, name: subject.display_name },
      can_edit: canEditCarePlan(actor, subject) || actor.role === 'owner',
      policies: mergeCarePolicies(policies.rows.map((p) => ({ ...p, set_by: 'caregiver' as const }))),
      day: day.rows.map((a) => ({ kind: a.kind, at: a.at.toISOString(), ok: a.ok })),
      alerts: alerts.rows.map((n) => ({
        kind: n.kind,
        text: n.text,
        at: n.created_at.toISOString(),
        acknowledged_at: iso(n.acknowledged_at),
      })),
    };
  }

  async setCarePolicy(householdId: string, personId: string, input: CarePolicyInput) {
    await this.requireMember(householdId, personId);
    const [household, actor] = await Promise.all([this.household(householdId), this.speaker(householdId, personId)]);
    return this.care.setPolicy(household, actor, input);
  }

  // ---------------------------------------------------------------- settings and export

  async settings(householdId: string, personId: string) {
    await this.requireMember(householdId, personId);
    const { rows } = await this.db.query<{ name: string; timezone: string; region: string; retention_days: number }>(
      'SELECT name, timezone, region, retention_days FROM household WHERE id = $1',
      [householdId],
    );
    const household = rows[0];
    if (!household) throw new NotFoundException('No such household');
    return household;
  }

  /** How long raw events are kept. Tombstones outlive it by 30 days, so forgetting still sticks. */
  async setRetention(householdId: string, personId: string, days: number) {
    const actor = await this.requireMember(householdId, personId);
    if (actor.role !== 'owner') throw new ForbiddenException('Only the household owner can change retention');
    const { rows } = await this.db.query<{ retention_days: number }>(
      'UPDATE household SET retention_days = $2 WHERE id = $1 RETURNING retention_days',
      [householdId, days],
    );
    const updated = rows[0];
    if (!updated) throw new NotFoundException('No such household');
    await this.db.transaction((tx) =>
      audit(tx, {
        householdId,
        actorId: personId,
        action: 'console.retention_changed',
        targetType: 'household',
        targetId: householdId,
        detail: { retention_days: days },
      }),
    );
    return updated;
  }

  /** Everything this person is allowed to see, as JSON they can keep. */
  async export(householdId: string, personId: string) {
    const [settings, facts, rules, routines, actions, devices, people, notices] = await Promise.all([
      this.settings(householdId, personId),
      this.facts(householdId, personId, { state: 'all', limit: MAX_PAGE }),
      this.rulesFor(householdId, personId),
      this.routines(householdId, personId),
      this.actions(householdId, personId, MAX_PAGE),
      this.devices(householdId, personId),
      this.people(householdId, personId),
      this.notices(householdId, personId, MAX_PAGE),
    ]);
    return {
      exported_at: new Date().toISOString(),
      household: settings,
      people,
      facts,
      rules: rules.rules,
      blocked_actions: rules.blocked,
      routines,
      actions,
      devices,
      notices,
    };
  }

  /** The numbers the overview page leads with. */
  async overview(householdId: string, personId: string) {
    const actor = await this.requireMember(householdId, personId);
    const readable = await this.readable(householdId, actor);
    const { rows } = await this.db.query<{
      facts: number;
      forgotten: number;
      rules: number;
      routines: number;
      candidates: number;
      broken: number;
      actions_today: number;
      blocked_today: number;
      pending: number;
    }>(
      `SELECT
         (SELECT count(*)::int FROM fact WHERE household_id = $1 AND forgotten_at IS NULL AND valid_to IS NULL
            AND (scope_type = 'household' OR scope_id = ANY($2::uuid[]))) AS facts,
         (SELECT count(*)::int FROM fact WHERE household_id = $1 AND forgotten_at IS NOT NULL) AS forgotten,
         (SELECT count(*)::int FROM rule WHERE household_id = $1 AND removed_at IS NULL) AS rules,
         (SELECT count(*)::int FROM routine WHERE household_id = $1 AND status = 'active') AS routines,
         (SELECT count(*)::int FROM routine WHERE household_id = $1 AND status = 'candidate') AS candidates,
         (SELECT count(*)::int FROM routine WHERE household_id = $1 AND health <> 'ok') AS broken,
         (SELECT count(*)::int FROM action WHERE household_id = $1 AND created_at > now() - interval '24 hours')
           AS actions_today,
         (SELECT count(*)::int FROM action WHERE household_id = $1 AND status = 'blocked'
            AND created_at > now() - interval '24 hours') AS blocked_today,
         (SELECT count(*)::int FROM utterance WHERE household_id = $1 AND status = 'pending') AS pending`,
      [householdId, readable],
    );
    const [settings, context] = await Promise.all([
      this.settings(householdId, personId),
      this.contexts.read(householdId, personId),
    ]);
    return { counts: rows[0], household: settings, contexts: context.contexts, quiet_hours: context.quiet_hours };
  }
}
