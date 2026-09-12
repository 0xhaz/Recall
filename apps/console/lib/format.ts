/** Minutes past midnight, as a clock reads: 430 → "07:10". */
export const hhmm = (minute: number) =>
  `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;

export const percent = (score: number) => `${Math.round(score * 100)}%`;

const VERBS: Record<string, string> = {
  start: 'start',
  stop: 'stop',
  on: 'turn on',
  off: 'turn off',
  play: 'play',
  dim: 'dim',
  open: 'open',
  taken: 'take',
  morning: 'say good morning',
  night: 'say good night',
};

/** Device kinds read as plain English: "coffee_machine.start" → "start the coffee machine". */
export function describeKind(kind: string): string {
  if (kind === 'media.play') return 'put on music';
  if (kind.startsWith('checkin.')) return `${VERBS[kind.slice(8)] ?? 'check in'}`;
  const dot = kind.lastIndexOf('.');
  if (dot < 0) return kind.replaceAll('_', ' ');
  const thing = kind.slice(0, dot).replaceAll('_', ' ').replaceAll('.', ' ');
  const verb = kind.slice(dot + 1);
  return `${VERBS[verb] ?? verb} the ${thing}`;
}

export const sentence = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
