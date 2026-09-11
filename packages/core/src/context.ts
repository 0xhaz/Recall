import { isWeekend } from './routines.js';

// The context engine (architecture.md §3): signals in, a few named contexts out. Routines and
// offers key off contexts, never raw signals. Scores, not classes: several can be live at once.

export const CONTEXTS = ['workout', 'wind_down', 'party', 'festive', 'focus'] as const;
export type ContextName = (typeof CONTEXTS)[number];
/** Workout belongs to a person; the others describe the household. */
export const PERSONAL_CONTEXTS: ReadonlySet<ContextName> = new Set(['workout']);

export interface Scored {
  score: number;
  reasons: string[];
}

export interface RecentEvent {
  kind: string;
  person_id: string | null;
  device_id: string | null;
  payload: Record<string, unknown>;
  /** When it happened (ISO). */
  at: string;
}

export interface PersonSignals {
  hr_bpm: number | null;
  motion_spm: number | null;
}

export interface HouseholdSignals {
  lights_dim: boolean;
  charging: boolean;
  noise_db: number | null;
  voices: number;
  arrivals: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const num = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : Number.NaN;
  return Number.isFinite(n) ? n : null;
};
const mean = (xs: number[]): number | null => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

/**
 * Turn the last hour of device reports into signals: heart rate and motion over the last 3 minutes
 * per person, the latest lights and charging state, noise over 5 minutes, distinct voices in one
 * room over 15 minutes, and arrivals over the hour.
 */
export function deriveSignals(
  events: readonly RecentEvent[],
  now: Date,
): { people: Map<string, PersonSignals>; household: HouseholdSignals } {
  const t = now.getTime();
  const within = (e: RecentEvent, minutes: number) => {
    const at = Date.parse(e.at);
    return at <= t && t - at <= minutes * 60_000;
  };
  const samples = new Map<string, { hr: number[]; spm: number[] }>();
  const person = (id: string) => {
    const existing = samples.get(id);
    if (existing) return existing;
    const fresh = { hr: [] as number[], spm: [] as number[] };
    samples.set(id, fresh);
    return fresh;
  };
  let lights: RecentEvent | null = null;
  let charging: RecentEvent | null = null;
  const noise: number[] = [];
  const voicesByRoom = new Map<string, Set<string>>();
  let reportedVoices = 0;
  let arrivals = 0;

  for (const e of events) {
    if (!within(e, 60)) continue;
    if (e.kind === 'hr.sample' && e.person_id && within(e, 3)) {
      const bpm = num(e.payload.bpm);
      if (bpm) person(e.person_id).hr.push(bpm);
    } else if (e.kind === 'phone.motion' && e.person_id && within(e, 3)) {
      const spm = num(e.payload.steps_per_min);
      if (spm !== null) person(e.person_id).spm.push(spm);
    } else if (e.kind.startsWith('lights.')) {
      if (!lights || lights.at <= e.at) lights = e;
    } else if (e.kind === 'phone.charging') {
      if (!charging || charging.at <= e.at) charging = e;
    } else if (e.kind === 'sound.level' && within(e, 5)) {
      const db = num(e.payload.db);
      if (db !== null) noise.push(db);
    } else if (e.kind === 'session.turn' && e.person_id && e.device_id && within(e, 15)) {
      const room = voicesByRoom.get(e.device_id) ?? new Set<string>();
      room.add(e.person_id);
      voicesByRoom.set(e.device_id, room);
    } else if (e.kind === 'presence.voices' && within(e, 15)) {
      reportedVoices = Math.max(reportedVoices, num(e.payload.count) ?? 0);
    } else if (e.kind === 'door.arrival' || e.kind === 'ring.arrival') {
      arrivals++;
    }
  }

  const dim =
    !!lights &&
    (lights.kind.endsWith('.dim') || lights.kind.endsWith('.off') || (num(lights.payload.brightness) ?? 100) < 30);
  return {
    people: new Map([...samples].map(([id, s]) => [id, { hr_bpm: mean(s.hr), motion_spm: mean(s.spm) }])),
    household: {
      lights_dim: dim,
      charging: charging?.payload.charging === true,
      noise_db: mean(noise),
      voices: Math.max(reportedVoices, 0, ...[...voicesByRoom.values()].map((room) => room.size)),
      arrivals,
    },
  };
}

export interface WorkoutInput {
  hr_bpm: number | null;
  resting_hr: number;
  /** Heart rate over resting that counts as exercise for this person (default 1.2: 20% above). */
  threshold: number;
  motion_spm: number | null;
  near_routine: boolean;
}

/** Thresholds are relative to the person's own resting rate, never absolute. */
export function scoreWorkout(w: WorkoutInput): Scored {
  let score = 0;
  const reasons: string[] = [];
  if (w.hr_bpm !== null) {
    const ratio = w.hr_bpm / w.resting_hr;
    const above = `heart rate ${Math.round((ratio - 1) * 100)}% above resting`;
    if (ratio >= w.threshold) {
      score += 0.5 + Math.min(0.2, ratio - w.threshold);
      reasons.push(above);
    } else if (ratio >= w.threshold - 0.1) {
      score += 0.25;
      reasons.push(above);
    }
  }
  if (w.motion_spm !== null && w.motion_spm >= 100) {
    score += 0.3;
    reasons.push('moving fast');
  } else if (w.motion_spm !== null && w.motion_spm >= 60) {
    score += 0.15;
    reasons.push('walking');
  }
  if (w.near_routine) {
    score += 0.2;
    reasons.push('usual workout time');
  }
  return { score: round2(Math.min(1, score)), reasons };
}

export interface HouseholdInput extends HouseholdSignals {
  local: { date: string; minute: number };
  sleeping: boolean;
  festival: { today: string | null; near: string | null };
}

export function scoreHousehold(s: HouseholdInput): Record<Exclude<ContextName, 'workout'>, Scored> {
  const m = s.local.minute;
  const weekend = isWeekend(s.local.date);

  const windDown: Scored = { score: 0, reasons: [] };
  if (s.sleeping) {
    windDown.score = 1;
    windDown.reasons.push('someone is asleep');
  } else {
    if (m >= 22 * 60 || m < 5 * 60) {
      windDown.score += 0.4;
      windDown.reasons.push('late evening');
    } else if (m >= 21 * 60) {
      windDown.score += 0.2;
      windDown.reasons.push('evening');
    }
    if (s.lights_dim) {
      windDown.score += 0.25;
      windDown.reasons.push('lights dimmed');
    }
    if (s.charging) {
      windDown.score += 0.15;
      windDown.reasons.push('phone charging');
    }
    if (s.noise_db !== null && s.noise_db < 35) {
      windDown.score += 0.2;
      windDown.reasons.push('quiet');
    }
  }

  const party: Scored = { score: 0, reasons: [] };
  if (s.voices >= 3) {
    party.score += 0.5;
    party.reasons.push(`${s.voices} voices in one room`);
  } else if (s.voices === 2) {
    party.score += 0.2;
    party.reasons.push('two voices in one room');
  }
  if (s.voices >= 2 && (m >= 18 * 60 || weekend)) {
    party.score += 0.15;
    party.reasons.push(weekend ? 'weekend' : 'evening');
  }
  if (s.arrivals >= 2) {
    party.score += 0.2;
    party.reasons.push('guests arriving');
  }
  if (s.noise_db !== null && s.noise_db > 70) {
    party.score += 0.2;
    party.reasons.push('loud');
  }

  const festive: Scored = { score: 0, reasons: [] };
  if (s.festival.today) {
    festive.score = 0.6;
    festive.reasons.push(s.festival.today);
  } else if (s.festival.near) {
    festive.score = 0.3;
    festive.reasons.push(`${s.festival.near} is near`);
  }
  if (festive.score > 0 && s.arrivals >= 1) {
    festive.score += 0.1;
    festive.reasons.push('visitors');
  }

  const focus: Scored = { score: 0, reasons: [] };
  if (party.score < 0.5) {
    if (!weekend && m >= 9 * 60 && m < 17 * 60) {
      focus.score += 0.3;
      focus.reasons.push('working hours');
    }
    if (s.voices <= 1) {
      focus.score += 0.2;
      focus.reasons.push('no conversation');
    }
    if (s.noise_db !== null && s.noise_db < 40) {
      focus.score += 0.2;
      focus.reasons.push('quiet');
    }
  }

  const done = (c: Scored): Scored => ({ score: round2(Math.min(1, c.score)), reasons: c.reasons });
  return { wind_down: done(windDown), party: done(party), festive: done(festive), focus: done(focus) };
}

export interface ContextConfig {
  /** Score needed to switch on, held for hold_s (debounce). */
  enter: number;
  hold_s: number;
  /** Score below which it switches off, held for exit_hold_s (hysteresis). */
  exit: number;
  exit_hold_s: number;
  /** How long a manual "on" or "off" wins over the signals. */
  manual_minutes: number;
}

export const CONTEXT_CONFIG: Record<ContextName, ContextConfig> = {
  workout: { enter: 0.6, hold_s: 60, exit: 0.35, exit_hold_s: 300, manual_minutes: 90 },
  wind_down: { enter: 0.55, hold_s: 120, exit: 0.3, exit_hold_s: 600, manual_minutes: 120 },
  party: { enter: 0.6, hold_s: 120, exit: 0.3, exit_hold_s: 900, manual_minutes: 180 },
  festive: { enter: 0.5, hold_s: 0, exit: 0.3, exit_hold_s: 0, manual_minutes: 240 },
  focus: { enter: 0.6, hold_s: 300, exit: 0.4, exit_hold_s: 300, manual_minutes: 120 },
};

export interface ContextState {
  active: boolean;
  since: string | null;
  above_since: string | null;
  below_since: string | null;
  manual_until: string | null;
}

export const IDLE_CONTEXT: ContextState = {
  active: false,
  since: null,
  above_since: null,
  below_since: null,
  manual_until: null,
};

/** One debounced step: switch on after holding above `enter`, off after holding below `exit`; manual wins until it expires. */
export function stepContext(prev: ContextState, score: number, now: Date, cfg: ContextConfig): ContextState {
  const t = now.getTime();
  const stamp = now.toISOString();
  let state = prev;
  if (state.manual_until) {
    if (Date.parse(state.manual_until) > t) return state;
    state = { ...IDLE_CONTEXT, active: state.active, since: state.since };
  }
  if (!state.active) {
    if (score < cfg.enter) return { ...state, above_since: null, below_since: null };
    const above = state.above_since ?? stamp;
    if (t - Date.parse(above) >= cfg.hold_s * 1000) return { ...IDLE_CONTEXT, active: true, since: stamp };
    return { ...state, above_since: above };
  }
  if (score >= cfg.exit) return { ...state, below_since: null };
  const below = state.below_since ?? stamp;
  if (t - Date.parse(below) >= cfg.exit_hold_s * 1000) return { ...IDLE_CONTEXT };
  return { ...state, below_since: below };
}
