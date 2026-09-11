import { Inject, Injectable } from '@nestjs/common';
import {
  type ActionDetails,
  type ActionIntent,
  type ActionSource,
  ADDRESS_FACT,
  asDeviceState,
  type ContextName,
  type DayPattern,
  type DeviceCommand,
  dayMatches,
  describeKind,
  evaluatePreflight,
  evaluateRules,
  formatMinute,
  intentForKind,
  inverseCommand,
  localClock,
  MALAYSIA_HOLIDAYS_2026,
  type OfferStats,
  type OfferTier,
  offerTier,
  type PastOrder,
  type Preflight,
  type RuleRef,
  signedMinutes,
  temporalStamp,
  UNDO_WINDOW_S,
} from '@recall/core';
import type { ContextReading } from '../context/context.service.js';
import { ContextService } from '../context/context.service.js';
import { MusicService } from '../context/music.service.js';
import { Db } from '../db/db.js';
import { EventLog, lockHousehold } from '../events/event-log.service.js';
import { type Household, MemoryService, type Speaker } from '../memory/memory.service.js';
import { localMinute } from '../routines/activity.js';
import { RulesService } from '../rules/rules.service.js';

/** A check is only good while what it was checked against still holds. */
const DECIDE_WITHIN_MS = 30 * 60_000;
/** A routine is offered from 20 minutes before its usual time to 10 minutes after (usual − now). */
const DUE_FROM = -10;
const DUE_TO = 20;
const CHAIN_WITHIN_MS = 45 * 60_000;
const REOFFER_HOURS = { routine: 12, music: 2 };
/** Dismissed this many more times than accepted: stop offering. */
const BACK_OFF = 3;
const MUSIC_CONTEXTS: readonly ContextName[] = ['workout', 'party', 'festive', 'focus'];
const DECIDES_FOR_OTHERS = new Set(['owner', 'adult', 'caregiver']);

export interface ActionInput {
  intent: ActionIntent;
  summary: string;
  topics?: string[];
  device?: string;
  details?: ActionDetails;
  command?: DeviceCommand;
}

interface Offer {
  source: ActionSource;
  offerKey: string;
  routineId: string | null;
  context: ContextName | null;
  say: (tier: OfferTier) => string;
}

interface Candidate {
  input: ActionInput;
  offer: Offer;
  rank: number;
}

interface ActionRow {
  id: string;
  person_id: string | null;
  device_id: string | null;
  intent: ActionIntent;
  summary: string;
  topics: string[];
  details: ActionDetails;
  command: DeviceCommand | null;
  routine_id: string | null;
  status: string;
  preflight: Preflight;
  created_at: Date;
  decided_at: Date | null;
  undo_until: Date | null;
}

interface RoutineRow {
  id: string;
  person_id: string | null;
  kind: string;
  days: DayPattern;
  center_minute: number;
  sequence: string[];
  accepted: number;
  dismissed: number;
}

const ACTION_COLUMNS =
  'id, person_id, device_id, intent, summary, topics, details, command, routine_id, status, preflight, created_at, decided_at, undo_until';

export type PreflightResult = Preflight & { action_id: string };

export interface OfferView {
  action_id: string;
  tier: OfferTier;
  say: string;
  summary: string;
  source: ActionSource;
  command: DeviceCommand | null;
  undo_until?: string | null;
}

export interface ProposeResult {
  offers: OfferView[];
  not_offered: { summary: string; reason: string; blocked_by: RuleRef | null; message: string }[];
  withheld?: { reason: 'quiet_hours'; because: string[] };
  message: string;
}

export interface DecideResult {
  action_id?: string;
  status?: string;
  refused?: string;
  undo_until?: string | null;
  command?: DeviceCommand | null;
  message: string;
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * Everything done on a person's behalf goes through here (architecture.md §5): checked first
 * against rules, quiet hours and what's on record; offered only with a source; recorded with an
 * undo window; announced to devices as action.executed / action.undone (a tombstone).
 */
@Injectable()
export class ActionService {
  constructor(
    @Inject(Db) private readonly db: Db,
    @Inject(EventLog) private readonly events: EventLog,
    @Inject(RulesService) private readonly rules: RulesService,
    @Inject(ContextService) private readonly contexts: ContextService,
    @Inject(MusicService) private readonly music: MusicService,
    @Inject(MemoryService) private readonly memory: MemoryService,
  ) {}

  /** Check something the person asked for; recorded so decide_action can carry it out. */
  async preflight(
    household: Household,
    speaker: Speaker | null,
    input: ActionInput,
    now: Date = new Date(),
  ): Promise<PreflightResult> {
    const result = await this.check(household, speaker, input, null, now);
    const id = await this.record(household, speaker, input, null, result, 'suggest');
    return { action_id: id, ...result };
  }

  /** At most one offer: a routine that's due, the next step of a chain, or music for the live context. */
  async propose(
    household: Household,
    speaker: Speaker | null,
    device: string | null,
    now: Date = new Date(),
  ): Promise<ProposeResult> {
    const personId = speaker?.person_id ?? null;
    const reading = await this.contexts.read(household.id, personId, now);
    if (reading.quiet_hours.active) {
      return {
        offers: [],
        not_offered: [],
        withheld: { reason: 'quiet_hours', because: reading.quiet_hours.because },
        message: 'Quiet hours: offer nothing unprompted.',
      };
    }
    const offered = await this.recentlyOffered(household.id, now);
    const candidates = [
      ...(await this.routineCandidates(household, personId, device, offered, now)),
      ...(await this.musicCandidates(household, speaker, device, reading, offered, now)),
    ];

    const notOffered: ProposeResult['not_offered'] = [];
    for (const c of candidates) {
      const result = await this.check(household, speaker, c.input, c.offer, now);
      if (result.decision === 'block') {
        notOffered.push({
          summary: c.input.summary,
          reason: result.blocked_by ? 'rule' : (result.withheld?.reason ?? 'blocked'),
          blocked_by: result.blocked_by,
          message: result.message,
        });
        continue;
      }
      const tier =
        result.decision === 'confirm'
          ? 'suggest'
          : offerTier(c.input.intent, await this.stats(household.id, c.offer.offerKey), c.offer.context);
      const id = await this.record(household, speaker, c.input, c.offer, result, tier);
      const view: OfferView = {
        action_id: id,
        tier,
        say: c.offer.say(tier),
        summary: c.input.summary,
        source: c.offer.source,
        command: c.input.command ?? null,
      };
      if (tier === 'act') {
        const row = await this.load(household.id, id);
        if (row) view.undo_until = (await this.execute(household, row, now)).undo_until;
      }
      return {
        offers: [view],
        not_offered: notOffered,
        message:
          tier === 'act'
            ? 'Already started, as usual: say so and mention undo.'
            : 'Offer it and wait; pass the answer to decide_action.',
      };
    }
    return { offers: [], not_offered: notOffered, message: 'Nothing to offer right now.' };
  }

  /** The person's answer to an offer or a checked action. */
  async decide(
    household: Household,
    speaker: Speaker | null,
    actionId: string,
    decision: 'confirm' | 'dismiss',
    now: Date = new Date(),
  ): Promise<DecideResult> {
    if (!speaker) return { refused: 'unknown_speaker', message: 'Ask who is speaking before going ahead.' };
    const action = await this.load(household.id, actionId);
    if (!action) return { refused: 'not_found', message: 'No such action in this household.' };
    if (this.notYours(action, speaker)) {
      return { action_id: action.id, refused: 'not_yours', message: 'Only the person it is for can decide this.' };
    }
    if (action.status === 'blocked') {
      return { action_id: action.id, refused: 'blocked', message: action.preflight.message };
    }
    if (action.status !== 'checked' && action.status !== 'offered') {
      return {
        action_id: action.id,
        refused: 'already_decided',
        status: action.status,
        message: `Already ${action.status}.`,
      };
    }
    if (now.getTime() - action.created_at.getTime() > DECIDE_WITHIN_MS) {
      return { action_id: action.id, refused: 'expired', message: 'That was checked too long ago; check it again.' };
    }

    if (decision === 'dismiss') {
      await this.db.transaction(async (tx) => {
        await tx.query(`UPDATE action SET status = 'dismissed', decided_at = $2 WHERE id = $1`, [action.id, now]);
        if (action.routine_id) {
          await tx.query(
            `UPDATE routine SET dismissed = dismissed + 1, updated_at = now(),
                    status = CASE WHEN status = 'offered' THEN 'candidate' ELSE status END
              WHERE id = $1`,
            [action.routine_id],
          );
        }
      });
      return { action_id: action.id, status: 'dismissed', message: 'Okay, not now.' };
    }

    // A rule may have been stated since the check.
    const when = action.details.when ? new Date(action.details.when) : now;
    const reading = await this.contexts.read(household.id, action.person_id, now);
    const rules = evaluateRules(await this.rules.inForce(household.id), {
      intent: action.intent,
      topics: action.topics,
      household_id: household.id,
      person_id: action.person_id,
      person_role: speaker.person_id === action.person_id ? speaker.role : null,
      device: action.device_id,
      contexts: reading.contexts.filter((c) => c.active).map((c) => c.context),
      local: localClock(household.timezone, when),
      now,
    });
    if (rules.decision === 'block' && rules.blocked_by) {
      const message = `Not allowed: “${rules.blocked_by.text}”.`;
      await this.db.query(`UPDATE action SET status = 'blocked', preflight = preflight || $2::jsonb WHERE id = $1`, [
        action.id,
        JSON.stringify({ decision: 'block', blocked_by: rules.blocked_by, message }),
      ]);
      return { action_id: action.id, refused: 'blocked', message };
    }
    return this.execute(household, action, now);
  }

  /** Take back something done through Recall while its window is open; by default the speaker's latest. */
  async undo(
    household: Household,
    speaker: Speaker | null,
    actionId: string | undefined,
    now: Date = new Date(),
  ): Promise<DecideResult> {
    if (!speaker) return { refused: 'unknown_speaker', message: 'Ask who is speaking first.' };
    const action = actionId
      ? await this.load(household.id, actionId)
      : await this.latest(household.id, speaker.person_id);
    if (!action) {
      return {
        refused: 'nothing_to_undo',
        message: actionId ? 'No such action in this household.' : 'Nothing done through Recall to undo.',
      };
    }
    if (this.notYours(action, speaker)) {
      return { action_id: action.id, refused: 'not_yours', message: 'Only the person it was for can undo this.' };
    }
    if (action.status === 'undone') {
      return { action_id: action.id, refused: 'already_undone', message: `Already undone: ${action.summary}.` };
    }
    if (action.status !== 'executed') {
      return { action_id: action.id, refused: 'not_done', message: 'That was never carried out; nothing to undo.' };
    }
    if (!action.undo_until || action.undo_until.getTime() < now.getTime()) {
      const closed = action.undo_until && temporalStamp(household.timezone, action.undo_until).local_time.slice(0, 5);
      return {
        action_id: action.id,
        refused: 'window_closed',
        message: closed ? `Too late to undo: that closed at ${closed}.` : "That can't be undone.",
      };
    }

    const inverse = action.command ? inverseCommand(action.command) : null;
    await this.db.transaction(async (tx) => {
      await lockHousehold(tx, household.id);
      await tx.query(`UPDATE action SET status = 'undone', undone_at = $2 WHERE id = $1`, [action.id, now]);
      await this.events.append(tx, household.id, {
        kind: 'action.undone',
        payload: { action_id: action.id, command: inverse, device_id: action.device_id },
        personId: action.person_id,
        tombstone: true,
      });
      if (action.routine_id) {
        await tx.query('UPDATE routine SET dismissed = dismissed + 1, updated_at = now() WHERE id = $1', [
          action.routine_id,
        ]);
      }
    });
    return {
      action_id: action.id,
      status: 'undone',
      command: inverse,
      message: inverse
        ? `Undone: the device has been asked to ${describeKind(inverse.kind)}. Re-read device_state before saying so.`
        : action.command
          ? "Marked undone, but the device can't reverse this one itself."
          : `Undone: ${action.summary} is cancelled.`,
    };
  }

  private async check(
    household: Household,
    speaker: Speaker | null,
    input: ActionInput,
    offer: Offer | null,
    now: Date,
  ): Promise<Preflight> {
    const details = input.details ?? {};
    const given = details.when ? new Date(details.when) : null;
    const when = given && !Number.isNaN(given.getTime()) ? given : now;
    const personId = speaker?.person_id ?? null;
    const needsOrders = ['order.food', 'purchase', 'notification'].includes(input.intent);
    const [inForce, reading, orders, knownAddresses, venueFacts, routines] = await Promise.all([
      this.rules.inForce(household.id),
      this.contexts.read(household.id, personId, now),
      needsOrders ? this.orderHistory(household.id, now) : [],
      details.address ? this.knownAddresses(household.id, speaker) : [],
      details.venue ? this.venueFacts(household.id, speaker, details.venue) : [],
      personId && given ? this.routinesOn(household, personId, when) : [],
    ]);
    const rules = evaluateRules(inForce, {
      intent: input.intent,
      topics: input.topics ?? [],
      household_id: household.id,
      person_id: personId,
      person_role: speaker?.role ?? null,
      device: input.device ?? null,
      contexts: reading.contexts.filter((c) => c.active).map((c) => c.context),
      local: localClock(household.timezone, when),
      now,
    });
    return evaluatePreflight({
      action: { intent: input.intent, summary: input.summary, topics: input.topics ?? [], details },
      proactive: offer !== null,
      source: offer?.source ?? null,
      speaker: speaker ? { role: speaker.role } : null,
      rules,
      quietHours: reading.quiet_hours,
      knownAddresses,
      venueFacts,
      orders,
      routines,
      whenMinute: given ? localMinute(household.timezone, when).minute : null,
      now,
    });
  }

  private async record(
    household: Household,
    speaker: Speaker | null,
    input: ActionInput,
    offer: Offer | null,
    result: Preflight,
    tier: OfferTier,
  ): Promise<string> {
    const status = result.decision === 'block' ? 'blocked' : offer ? 'offered' : 'checked';
    const { rows } = await this.db.query<{ id: string }>(
      `INSERT INTO action (household_id, region, person_id, device_id, intent, summary, topics, details, command,
                           proactive, source, offer_key, routine_id, tier, status, preflight)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
       RETURNING id`,
      [
        household.id,
        household.region,
        speaker?.person_id ?? null,
        input.device ?? null,
        input.intent,
        input.summary,
        input.topics ?? [],
        JSON.stringify(input.details ?? {}),
        input.command ? JSON.stringify(input.command) : null,
        offer !== null,
        offer ? JSON.stringify(offer.source) : null,
        offer?.offerKey ?? null,
        offer?.routineId ?? null,
        tier,
        status,
        JSON.stringify(result),
      ],
    );
    if (offer?.routineId && status === 'offered') {
      await this.db.query(
        `UPDATE routine SET status = 'offered', updated_at = now() WHERE id = $1 AND status = 'candidate'`,
        [offer.routineId],
      );
    }
    const id = rows[0]?.id;
    if (!id) throw new Error('Action was not recorded');
    return id;
  }

  private async execute(household: Household, action: ActionRow, now: Date): Promise<DecideResult> {
    const windowS = UNDO_WINDOW_S[action.intent] ?? 0;
    const undoUntil = windowS > 0 ? new Date(now.getTime() + windowS * 1000) : null;
    await this.db.transaction(async (tx) => {
      await lockHousehold(tx, household.id);
      await tx.query(`UPDATE action SET status = 'executed', decided_at = $2, undo_until = $3 WHERE id = $1`, [
        action.id,
        now,
        undoUntil,
      ]);
      await this.events.append(tx, household.id, {
        kind: 'action.executed',
        payload: {
          action_id: action.id,
          intent: action.intent,
          summary: action.summary,
          command: action.command,
          device_id: action.device_id,
        },
        personId: action.person_id,
      });
      if (action.routine_id) {
        await tx.query(
          `UPDATE routine SET accepted = accepted + 1, updated_at = now(),
                  status = CASE WHEN accepted + 1 >= 2 THEN 'active' WHEN status = 'candidate' THEN 'offered' ELSE status END
            WHERE id = $1`,
          [action.routine_id],
        );
      }
    });
    const until = undoUntil && temporalStamp(household.timezone, undoUntil).local_time.slice(0, 5);
    return {
      action_id: action.id,
      status: 'executed',
      undo_until: undoUntil?.toISOString() ?? null,
      command: action.command,
      message: [
        action.command ? 'Sent to the device; re-read device_state before saying it happened.' : 'Done.',
        until ? `It can be undone until ${until}.` : "This one can't be undone.",
      ].join(' '),
    };
  }

  private async load(householdId: string, id: string): Promise<ActionRow | null> {
    const { rows } = await this.db.query<ActionRow>(
      `SELECT ${ACTION_COLUMNS} FROM action WHERE household_id = $1 AND id = $2`,
      [householdId, id],
    );
    return rows[0] ?? null;
  }

  /** "Undo that": the speaker's most recent action, if it's still the one to take back. */
  private async latest(householdId: string, personId: string): Promise<ActionRow | null> {
    const { rows } = await this.db.query<ActionRow>(
      `SELECT ${ACTION_COLUMNS} FROM action
        WHERE household_id = $1 AND person_id = $2 AND status IN ('executed', 'undone')
        ORDER BY decided_at DESC LIMIT 1`,
      [householdId, personId],
    );
    return rows[0] ?? null;
  }

  private notYours(action: ActionRow, speaker: Speaker): boolean {
    return !!action.person_id && action.person_id !== speaker.person_id && !DECIDES_FOR_OTHERS.has(speaker.role);
  }

  private async stats(householdId: string, offerKey: string): Promise<OfferStats> {
    const { rows } = await this.db.query<OfferStats>(
      `SELECT count(*) FILTER (WHERE status = 'executed')::int AS accepted,
              count(*) FILTER (WHERE status IN ('dismissed', 'undone'))::int AS dismissed,
              (array_agg(status ORDER BY created_at DESC)
                 FILTER (WHERE status IN ('executed', 'dismissed', 'undone')))[1] AS last
         FROM action WHERE household_id = $1 AND offer_key = $2`,
      [householdId, offerKey],
    );
    return rows[0] ?? { accepted: 0, dismissed: 0, last: null };
  }

  private async recentlyOffered(householdId: string, now: Date): Promise<Set<string>> {
    const { rows } = await this.db.query<{ offer_key: string; at: Date }>(
      `SELECT offer_key, max(created_at) AS at FROM action
        WHERE household_id = $1 AND offer_key IS NOT NULL AND status <> 'blocked'
          AND created_at > $2::timestamptz - make_interval(hours => ${REOFFER_HOURS.routine})
        GROUP BY offer_key`,
      [householdId, now],
    );
    return new Set(
      rows
        .filter(
          (r) => r.offer_key.startsWith('routine:') || now.getTime() - r.at.getTime() < REOFFER_HOURS.music * 3_600_000,
        )
        .map((r) => r.offer_key),
    );
  }

  private async routineCandidates(
    household: Household,
    personId: string | null,
    device: string | null,
    offered: Set<string>,
    now: Date,
  ): Promise<Candidate[]> {
    const local = localMinute(household.timezone, now);
    const holiday = MALAYSIA_HOLIDAYS_2026.has(local.date);
    const [{ rows: routines }, { rows: done }] = await Promise.all([
      this.db.query<RoutineRow>(
        `SELECT id, person_id, kind, days, center_minute, sequence, accepted, dismissed FROM routine
          WHERE household_id = $1 AND status <> 'retired' AND health <> 'broken'
            AND (person_id IS NULL OR person_id = $2::uuid)`,
        [household.id, personId],
      ),
      this.db.query<{ kind: string; last: Date }>(
        `SELECT kind, max(at) AS last FROM activity
          WHERE household_id = $1 AND local_date = $2 AND (person_id IS NULL OR person_id = $3::uuid)
          GROUP BY kind`,
        [household.id, local.date, personId],
      ),
    ]);
    const doneToday = new Map(done.map((d) => [d.kind, d.last]));
    const justDone = (kind: string) => {
      const last = doneToday.get(kind);
      return !!last && now.getTime() - last.getTime() <= CHAIN_WITHIN_MS;
    };

    const candidates: Candidate[] = [];
    for (const r of routines) {
      const intent = intentForKind(r.kind);
      const key = `routine:${r.id}`;
      if (!intent || doneToday.has(r.kind) || offered.has(key) || r.dismissed - r.accepted >= BACK_OFF) continue;
      const dueIn = signedMinutes(r.center_minute, local.minute);
      const due =
        !(holiday && r.days === 'weekdays') && dayMatches(r.days, local.date) && dueIn >= DUE_FROM && dueIn <= DUE_TO;
      const after = routines.find(
        (p) => p.person_id === r.person_id && p.sequence.includes(r.kind) && justDone(p.kind),
      );
      if (!due && !after) continue;

      const title = r.kind === 'media.play' ? await this.lastTitle(household.id, r.person_id, r.kind) : null;
      const label = describeKind(r.kind, title);
      const usual = formatMinute(r.center_minute);
      candidates.push({
        rank: due ? Math.abs(dueIn) : 100,
        input: {
          intent,
          summary: capitalize(label),
          ...(device ? { device } : {}),
          command: { kind: r.kind, payload: title ? { title } : {} },
        },
        offer: {
          source: {
            type: 'routine',
            routine_id: r.id,
            text: after ? `usually follows: ${describeKind(after.kind)}` : `usually around ${usual} (${r.days})`,
          },
          offerKey: key,
          routineId: r.id,
          context: null,
          say: (tier) =>
            tier === 'act'
              ? `${capitalize(label)}, as usual. Say “undo” to stop.`
              : after
                ? `Shall I ${label} next?`
                : `It's about ${usual}. Shall I ${label}?`,
        },
      });
    }
    return candidates.sort((a, b) => a.rank - b.rank);
  }

  private async musicCandidates(
    household: Household,
    speaker: Speaker | null,
    device: string | null,
    reading: ContextReading,
    offered: Set<string>,
    now: Date,
  ): Promise<Candidate[]> {
    const live = reading.contexts.filter((c) => c.active);
    const context = MUSIC_CONTEXTS.find((c) => live.some((l) => l.context === c));
    if (!context) return [];
    // Answers are per person: one person's "no" to workout music says nothing about another's.
    const key = `music:${context}:${speaker?.person_id ?? 'household'}`;
    if (offered.has(key)) return [];
    if (device && (await this.playing(household.id, device))) return [];

    const suggestion = await this.music.suggest(household, speaker, { context, ...(device ? { device } : {}), now });
    const top = suggestion.tracks[0];
    const label = context.replace('_', '-');
    const title = top?.title ?? `music for the ${label}`;
    const reasons = live.find((l) => l.context === context)?.reasons ?? [];
    return [
      {
        rank: 200,
        input: {
          intent: 'media.play',
          summary: top ? `Play ${top.title} (mock catalogue)` : `Play music for the ${label}`,
          ...(device ? { device } : {}),
          ...(top
            ? { command: { kind: 'media.play', payload: { title: top.title, track_id: top.id, source: 'mock' } } }
            : {}),
        },
        offer: {
          source: { type: 'context', context, text: reasons.join(', ') || label },
          offerKey: key,
          routineId: null,
          context,
          say: (tier) =>
            tier === 'act'
              ? `Putting on ${title} for your ${label}. Say “undo” to stop.`
              : context === 'workout'
                ? `Looks like a workout. Want ${title}?`
                : `Want ${title} for the ${label}?`,
        },
      },
    ];
  }

  private async playing(householdId: string, device: string): Promise<boolean> {
    const { rows } = await this.db.query<{ state: unknown }>(
      'SELECT state FROM device WHERE household_id = $1 AND device_id = $2',
      [householdId, device],
    );
    const media = asDeviceState(rows[0]?.state).media;
    return !!media?.playing && !media.playing.paused;
  }

  private async lastTitle(householdId: string, personId: string | null, kind: string): Promise<string | null> {
    const { rows } = await this.db.query<{ title: string | null }>(
      `SELECT e.payload->>'title' AS title FROM activity a JOIN event e ON e.event_id = a.event_id
        WHERE a.household_id = $1 AND a.person_id IS NOT DISTINCT FROM $2::uuid AND a.kind = $3 AND e.payload ? 'title'
        ORDER BY a.at DESC LIMIT 1`,
      [householdId, personId, kind],
    );
    return rows[0]?.title ?? null;
  }

  private async orderHistory(householdId: string, now: Date): Promise<PastOrder[]> {
    const { rows } = await this.db.query<{ id: string; intent: string; details: ActionDetails; decided_at: Date }>(
      `SELECT id, intent, details, decided_at FROM action
        WHERE household_id = $1 AND status = 'executed' AND intent IN ('order.food', 'purchase')
          AND decided_at > $2::timestamptz - interval '90 days'
        ORDER BY decided_at DESC LIMIT 50`,
      [householdId, now],
    );
    return rows.map((r) => ({
      action_id: r.id,
      intent: r.intent,
      venue: r.details.venue ?? null,
      address: r.details.address ?? null,
      amount: typeof r.details.amount === 'number' ? r.details.amount : null,
      items: r.details.items ?? [],
      at: r.decided_at.toISOString(),
    }));
  }

  /** Facts about a venue ("the usual takeaway is Warung Mak Teh"): the place is known before any order. */
  private async venueFacts(
    householdId: string,
    speaker: Speaker | null,
    venue: string,
  ): Promise<{ fact_id: string; content: string }[]> {
    // Exact words matter here (a venue's name), so keyword search only: no embedding on this path.
    const hits = await this.memory.search(householdId, speaker, venue, { limit: 5, keywordOnly: true });
    return hits.map((h) => ({ fact_id: h.id, content: h.content }));
  }

  private async knownAddresses(
    householdId: string,
    speaker: Speaker | null,
  ): Promise<{ fact_id: string; content: string }[]> {
    const hits = await this.memory.search(householdId, speaker, 'address', { limit: 10, keywordOnly: true });
    return hits.filter((h) => ADDRESS_FACT.test(h.content)).map((h) => ({ fact_id: h.id, content: h.content }));
  }

  private async routinesOn(
    household: Household,
    personId: string,
    when: Date,
  ): Promise<{ kind: string; minute: number }[]> {
    const local = localMinute(household.timezone, when);
    const { rows } = await this.db.query<{ kind: string; days: DayPattern; center_minute: number }>(
      `SELECT kind, days, center_minute FROM routine WHERE household_id = $1 AND person_id = $2 AND status <> 'retired'`,
      [household.id, personId],
    );
    return rows.filter((r) => dayMatches(r.days, local.date)).map((r) => ({ kind: r.kind, minute: r.center_minute }));
  }
}
