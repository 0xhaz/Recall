import { Inject, Injectable } from '@nestjs/common';
import {
  type Affinity,
  type ContextName,
  evaluateRules,
  PERSONAL_CONTEXTS,
  type RuleDecision,
  rankTracks,
  temporalStamp,
  type Weekday,
} from '@recall/core';
import { Db } from '../db/db.js';
import type { Household, Speaker } from '../memory/memory.service.js';
import { RulesService } from '../rules/rules.service.js';
import { ContextService } from './context.service.js';

/** Which live context music is chosen for, most specific first. */
const PRIORITY: readonly ContextName[] = ['workout', 'party', 'festive', 'wind_down', 'focus'];
const RECENT_HOURS = 2;
const TOP = 3;

export interface MusicSuggestion {
  context: ContextName | null;
  catalogue: 'mock';
  tracks: { id: string; title: string; why: string[] }[];
  decision: RuleDecision['decision'];
  blocked_by: RuleDecision['blocked_by'];
  suppress_offer: boolean;
  message: string;
}

@Injectable()
export class MusicService {
  constructor(
    @Inject(Db) private readonly db: Db,
    @Inject(RulesService) private readonly rules: RulesService,
    @Inject(ContextService) private readonly contexts: ContextService,
  ) {}

  /** Ranked picks for the live (or given) context — unless a stated rule says no music now. */
  async suggest(
    household: Household,
    speaker: Speaker | null,
    opts: { context?: ContextName; device?: string; now?: Date } = {},
  ): Promise<MusicSuggestion> {
    const now = opts.now ?? new Date();
    const reading = await this.contexts.read(household.id, speaker?.person_id ?? null, now);
    const live = new Set(reading.contexts.filter((c) => c.active).map((c) => c.context));
    const context = opts.context ?? PRIORITY.find((c) => live.has(c)) ?? null;

    const local = temporalStamp(household.timezone, now);
    const decision = evaluateRules(await this.rules.inForce(household.id), {
      intent: 'media.play',
      household_id: household.id,
      person_id: speaker?.person_id ?? null,
      person_role: speaker?.role ?? null,
      device: opts.device ?? null,
      contexts: context ? [context] : [],
      local: { weekday: local.weekday.slice(0, 3).toLowerCase() as Weekday, time: local.local_time.slice(0, 5) },
      now,
    });
    const base = {
      context,
      catalogue: 'mock' as const,
      decision: decision.decision,
      blocked_by: decision.blocked_by,
      suppress_offer: decision.suppress_offer,
    };
    if (decision.decision === 'block') {
      return { ...base, tracks: [], message: `No music: “${decision.blocked_by?.text}”.` };
    }

    // Personal contexts use the speaker's taste; shared ones blend everyone at home.
    const listeners =
      context && PERSONAL_CONTEXTS.has(context) && speaker
        ? [{ id: speaker.person_id }]
        : (
            await this.db.query<{ id: string }>(
              `SELECT person_id AS id FROM membership WHERE household_id = $1 AND revoked_at IS NULL AND role <> 'guest'`,
              [household.id],
            )
          ).rows;
    const { rows: affinity } = await this.db.query<Affinity & { person_id: string; track_id: string }>(
      `SELECT person_id, track_id, plays, skips, completes FROM track_affinity
        WHERE household_id = $1 AND context = $2 AND person_id = ANY($3::uuid[])`,
      [household.id, context ?? '', listeners.map((l) => l.id)],
    );
    const byPerson = new Map<string, Map<string, Affinity>>();
    for (const a of affinity) {
      const map = byPerson.get(a.person_id) ?? new Map<string, Affinity>();
      map.set(a.track_id, a);
      byPerson.set(a.person_id, map);
    }
    const { rows: recent } = await this.db.query<{ track_id: string }>(
      `SELECT DISTINCT payload->>'track_id' AS track_id FROM event
        WHERE household_id = $1 AND kind = 'media.play' AND payload ? 'track_id'
          AND occurred_at > $2::timestamptz - make_interval(hours => ${RECENT_HOURS}) AND occurred_at <= $2`,
      [household.id, now],
    );

    const ranked = rankTracks(
      context,
      listeners.map((l) => byPerson.get(l.id) ?? new Map()),
      new Set(recent.map((r) => r.track_id)),
    ).slice(0, TOP);
    const tracks = ranked.map((r) => ({ id: r.track.id, title: r.track.title, why: r.why }));
    const top = tracks[0];
    const message = !top
      ? 'Nothing suitable in the catalogue.'
      : context
        ? `For ${context.replace('_', '-')}: ${top.title} (mock catalogue).`
        : `${top.title} (mock catalogue).`;
    return { ...base, tracks, message };
  }
}
