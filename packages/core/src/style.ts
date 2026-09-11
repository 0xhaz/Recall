// Tone dial (design.md §3.2 #6, §3.3): terse by default. Commentary, cheer and jokes are
// opt-in per person, never the default, and the assistant never labels the user's feelings.

export interface CommunicationStyle {
  verbosity: 'brief' | 'normal' | 'detailed';
  commentary: boolean;
  humour: boolean;
  emotional_language: boolean;
}

export const DEFAULT_STYLE: CommunicationStyle = {
  verbosity: 'brief',
  commentary: false,
  humour: false,
  emotional_language: false,
};

/** Rules that apply on top of any style; returned with every session_brief. */
export const RESPONSE_RULES = [
  'Transactional requests (lists, timers, lights, volume, media): confirm in a word or two.',
  'No tips, cheer, jokes or commentary unless response_style allows them.',
  "Never label the user's feelings. If something fails, say what failed and one next step.",
];

const VERBOSITY = new Set(['brief', 'normal', 'detailed']);

/** Stored style merged over the defaults; unknown or malformed keys are ignored. */
export function resolveStyle(stored: unknown): CommunicationStyle {
  const style = { ...DEFAULT_STYLE };
  if (!stored || typeof stored !== 'object') return style;
  const s = stored as Record<string, unknown>;
  if (typeof s.verbosity === 'string' && VERBOSITY.has(s.verbosity)) {
    style.verbosity = s.verbosity as CommunicationStyle['verbosity'];
  }
  for (const flag of ['commentary', 'humour', 'emotional_language'] as const) {
    if (typeof s[flag] === 'boolean') style[flag] = s[flag];
  }
  return style;
}
