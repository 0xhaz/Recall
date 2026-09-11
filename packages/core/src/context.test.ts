import { describe, expect, it } from 'vitest';
import {
  CONTEXT_CONFIG,
  deriveSignals,
  IDLE_CONTEXT,
  type RecentEvent,
  scoreHousehold,
  scoreWorkout,
  stepContext,
} from './context.js';
import { rankTracks } from './music.js';

const NOW = new Date('2026-09-28T15:00:00Z');
const ago = (seconds: number) => new Date(NOW.getTime() - seconds * 1000).toISOString();
const ev = (
  kind: string,
  seconds: number,
  payload: Record<string, unknown> = {},
  extra: Partial<RecentEvent> = {},
) => ({
  kind,
  person_id: 'alice',
  device_id: 'kitchen-echo',
  payload,
  at: ago(seconds),
  ...extra,
});

describe('deriveSignals', () => {
  it('averages heart rate over the last 3 minutes only, per person', () => {
    const { people } = deriveSignals(
      [ev('hr.sample', 600, { bpm: 200 }), ev('hr.sample', 60, { bpm: 140 }), ev('hr.sample', 30, { bpm: 160 })],
      NOW,
    );
    expect(people.get('alice')).toEqual({ hr_bpm: 150, motion_spm: null });
  });

  it('reads the room: latest lights, charging, noise, voices, arrivals', () => {
    const { household } = deriveSignals(
      [
        ev('lights.living.on', 1800, { brightness: 90 }),
        ev('lights.living.dim', 600, { brightness: 20 }),
        ev('phone.charging', 300, { charging: true }),
        ev('sound.level', 60, { db: 30 }),
        ev('session.turn', 60, {}, { person_id: 'a' }),
        ev('session.turn', 50, {}, { person_id: 'b' }),
        ev('session.turn', 40, {}, { person_id: 'c', device_id: 'bedroom-echo' }),
        ev('door.arrival', 1200),
        ev('lights.kitchen.on', 3700, { brightness: 100 }), // over an hour ago: ignored
      ],
      NOW,
    );
    expect(household).toEqual({ lights_dim: true, charging: true, noise_db: 30, voices: 2, arrivals: 1 });
  });
});

describe('scoring', () => {
  it('scores a workout relative to the resting heart rate, not in absolute bpm', () => {
    const run = scoreWorkout({ hr_bpm: 150, resting_hr: 65, threshold: 1.2, motion_spm: 160, near_routine: false });
    expect(run.score).toBe(1);
    expect(run.reasons).toEqual(['heart rate 131% above resting', 'moving fast']);
    const fitRunner = scoreWorkout({
      hr_bpm: 70,
      resting_hr: 50,
      threshold: 1.2,
      motion_spm: null,
      near_routine: false,
    });
    expect(fitRunner.score).toBe(0.7);
    expect(
      scoreWorkout({ hr_bpm: 70, resting_hr: 65, threshold: 1.2, motion_spm: null, near_routine: false }).score,
    ).toBe(0);
  });

  it('winds down late at night with dim lights, and fully when someone is asleep', () => {
    const late = { lights_dim: true, charging: true, noise_db: null, voices: 0, arrivals: 0 };
    const scores = scoreHousehold({
      ...late,
      local: { date: '2026-09-28', minute: 23 * 60 },
      sleeping: false,
      festival: { today: null, near: null },
    });
    expect(scores.wind_down).toEqual({ score: 0.8, reasons: ['late evening', 'lights dimmed', 'phone charging'] });
    const asleep = scoreHousehold({
      ...late,
      local: { date: '2026-09-28', minute: 14 * 60 },
      sleeping: true,
      festival: { today: null, near: null },
    });
    expect(asleep.wind_down.score).toBe(1);
  });

  it('knows a party and a festival when it sees one', () => {
    const scores = scoreHousehold({
      lights_dim: false,
      charging: false,
      noise_db: 75,
      voices: 4,
      arrivals: 3,
      local: { date: '2026-11-08', minute: 20 * 60 },
      sleeping: false,
      festival: { today: 'Deepavali', near: null },
    });
    expect(scores.party.score).toBe(1);
    expect(scores.festive).toEqual({ score: 0.7, reasons: ['Deepavali', 'visitors'] });
    expect(scores.focus.score).toBe(0);
  });
});

describe('stepContext', () => {
  const cfg = CONTEXT_CONFIG.workout;
  const at = (s: number) => new Date(NOW.getTime() + s * 1000);

  it("doesn't switch on for a short spike (a flight of stairs)", () => {
    let state = stepContext(IDLE_CONTEXT, 0.65, at(0), cfg);
    state = stepContext(state, 0.65, at(30), cfg);
    state = stepContext(state, 0.2, at(45), cfg);
    state = stepContext(state, 0.2, at(120), cfg);
    expect(state.active).toBe(false);
  });

  it('switches on after holding, and off only after holding below the lower threshold', () => {
    let state = stepContext(IDLE_CONTEXT, 0.8, at(0), cfg);
    expect(state.active).toBe(false);
    state = stepContext(state, 0.8, at(61), cfg);
    expect(state).toMatchObject({ active: true, since: at(61).toISOString() });
    state = stepContext(state, 0.4, at(200), cfg); // dips, but above the exit threshold
    state = stepContext(state, 0.1, at(300), cfg);
    state = stepContext(state, 0.1, at(500), cfg);
    expect(state.active).toBe(true);
    state = stepContext(state, 0.1, at(601), cfg);
    expect(state.active).toBe(false);
  });

  it('lets a manual on or off win until it expires', () => {
    const off = { ...IDLE_CONTEXT, manual_until: at(600).toISOString() };
    expect(stepContext(off, 1, at(300), cfg).active).toBe(false);
    const expired = stepContext(off, 1, at(700), cfg);
    expect(expired).toMatchObject({ active: false, manual_until: null, above_since: at(700).toISOString() });
  });
});

describe('rankTracks', () => {
  it('fits the context, and a skip in one context does not count in another', () => {
    const workout = rankTracks('workout', [new Map()], new Set());
    expect(workout[0]?.track.title).toBe('Running Mix');

    const skippedRunningMix = new Map([['mock-running-mix', { plays: 0, skips: 3, completes: 0 }]]);
    expect(rankTracks('workout', [skippedRunningMix], new Set())[0]?.track.title).toBe('Tempo Run');
    expect(rankTracks('wind_down', [new Map()], new Set())[0]?.track.title).toBe('Evening Calm');
  });

  it('rests what just played, and blends several listeners', () => {
    const ranked = rankTracks('workout', [new Map()], new Set(['mock-running-mix']));
    expect(ranked[0]?.track.title).toBe('Tempo Run');
    const lovesTempo = new Map([['mock-tempo-run', { plays: 5, skips: 0, completes: 5 }]]);
    const hatesTempo = new Map([['mock-tempo-run', { plays: 0, skips: 5, completes: 0 }]]);
    const blended = rankTracks('workout', [lovesTempo, hatesTempo], new Set()).find(
      (r) => r.track.id === 'mock-tempo-run',
    );
    expect(blended?.score).toBeLessThan(1);
  });
});
