import type { ContextName } from './context.js';

// The music policy (architecture.md §3.1) over a small mocked catalogue: invented titles, no real
// artists or songs, labelled "mock" wherever it is shown (workplan Q8).

export interface Track {
  id: string;
  title: string;
  /** 0 (calm) to 1 (intense). */
  energy: number;
  tempo: number;
  moods: ContextName[];
}

export const MOCK_CATALOGUE: readonly Track[] = [
  { id: 'mock-running-mix', title: 'Running Mix', energy: 0.9, tempo: 165, moods: ['workout'] },
  { id: 'mock-tempo-run', title: 'Tempo Run', energy: 0.85, tempo: 170, moods: ['workout'] },
  { id: 'mock-strength', title: 'Strength Session', energy: 0.8, tempo: 128, moods: ['workout', 'party'] },
  { id: 'mock-evening-calm', title: 'Evening Calm', energy: 0.15, tempo: 70, moods: ['wind_down'] },
  { id: 'mock-rain-piano', title: 'Rain and Piano', energy: 0.1, tempo: 60, moods: ['wind_down', 'focus'] },
  { id: 'mock-slow-sunday', title: 'Slow Sunday', energy: 0.25, tempo: 85, moods: ['wind_down'] },
  { id: 'mock-deep-focus', title: 'Deep Focus', energy: 0.3, tempo: 90, moods: ['focus'] },
  { id: 'mock-study-beats', title: 'Study Beats', energy: 0.35, tempo: 80, moods: ['focus'] },
  { id: 'mock-party-starters', title: 'Party Starters', energy: 0.85, tempo: 124, moods: ['party'] },
  { id: 'mock-family-karaoke', title: 'Family Karaoke', energy: 0.7, tempo: 110, moods: ['party', 'festive'] },
  { id: 'mock-raya-morning', title: 'Raya Morning', energy: 0.55, tempo: 100, moods: ['festive'] },
  { id: 'mock-lantern-night', title: 'Lantern Night', energy: 0.5, tempo: 96, moods: ['festive'] },
  { id: 'mock-festival-of-lights', title: 'Festival of Lights', energy: 0.6, tempo: 104, moods: ['festive'] },
  { id: 'mock-kitchen-radio', title: 'Kitchen Radio', energy: 0.5, tempo: 100, moods: [] },
];

export interface Affinity {
  plays: number;
  skips: number;
  completes: number;
}

export interface RankedTrack {
  track: Track;
  score: number;
  why: string[];
}

const TARGET_ENERGY: Record<ContextName, number> = {
  workout: 0.9,
  party: 0.8,
  festive: 0.6,
  focus: 0.35,
  wind_down: 0.15,
};

/** Played and finished pulls a track up; skipped pushes it down, hard. */
export function affinityWeight(a: Affinity | undefined): number {
  if (!a) return 1;
  const net = (a.plays + 2 * a.completes - 3 * a.skips) / (a.plays + a.skips + a.completes + 1);
  return Math.max(0.1, Math.min(2, 1 + net));
}

/**
 * Rank by fit to the context × energy match × the listeners' affinity in that context × a penalty
 * for what played in the last two hours. Several listeners (party, festive) are blended by average.
 */
export function rankTracks(
  context: ContextName | null,
  listeners: readonly ReadonlyMap<string, Affinity>[],
  recentlyPlayed: ReadonlySet<string>,
  catalogue: readonly Track[] = MOCK_CATALOGUE,
): RankedTrack[] {
  return catalogue
    .map((track) => {
      const why: string[] = [];
      const suits = context !== null && track.moods.includes(context);
      if (suits) why.push(`made for ${context.replace('_', '-')}`);
      const fit = context === null ? 0.6 : suits ? 1 : 0.2;
      const energy = context === null ? 1 : 1 - Math.abs(track.energy - TARGET_ENERGY[context]);
      const weights = listeners.map((l) => affinityWeight(l.get(track.id)));
      const affinity = weights.length ? weights.reduce((a, b) => a + b, 0) / weights.length : 1;
      if (affinity > 1.2) why.push('often played');
      else if (affinity < 0.8) why.push('often skipped');
      const recency = recentlyPlayed.has(track.id) ? 0.5 : 1;
      if (recency < 1) why.push('played recently');
      return { track, score: Math.round(fit * energy * affinity * recency * 1000) / 1000, why };
    })
    .sort((a, b) => b.score - a.score);
}
