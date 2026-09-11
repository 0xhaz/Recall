import type { SensitivityTag } from './types.js';

/** Never stored — not even as a placeholder (design.md §4.2, architecture.md §1.2). */
export type BlockedCategory = 'card_number' | 'credential' | 'account_number' | 'national_id' | 'diagnosis';

export interface Screened {
  /** The statement with every clause that holds blocked content removed. */
  text: string;
  redactions: BlockedCategory[];
  tags: SensitivityTag[];
}

const LONG_NUMBER = /\d(?:[\s-]?\d){5,}/;
// Diagnoses and named conditions are never stored; care plans don't need them (design.md §5).
const CONDITIONS =
  /\b(diagnos\w*|diabet\w*|dementia|alzheimer\w*|cancer|depressi\w*|adhd|autis\w*|epilep\w*|parkinson\w*|hiv|bipolar|schizophreni\w*|hypertension)\b/i;

const BLOCKERS: ReadonlyArray<readonly [BlockedCategory, (clause: string) => boolean]> = [
  ['card_number', hasCardNumber],
  [
    'credential',
    (c) => /\b(password|passcode|passwd|pin|otp|cvv|security code)\b[^.!?]*?(\bis\b|\bwas\b|[=:])\s*\S/i.test(c),
  ],
  ['account_number', (c) => /\b(account|acct|a\/c)\b/i.test(c) && LONG_NUMBER.test(c)],
  [
    'national_id',
    (c) =>
      /\b\d{6}-\d{2}-\d{4}\b/.test(c) || // MyKad
      /\b\d{3}-\d{2}-\d{4}\b/.test(c) || // SSN
      (/\b(ic|mykad|nric|passport|ssn|social security)\b/i.test(c) && LONG_NUMBER.test(c)),
  ],
  ['diagnosis', (c) => CONDITIONS.test(c)],
];

const TAGGERS: ReadonlyArray<readonly [SensitivityTag, RegExp]> = [
  [
    'health',
    /\b(allerg\w*|asthma|inhaler|epipen|medication|medicine|pills?|tablets?|insulin|blood pressure|pregnan\w*|surgery|doctor|clinic|hospital|therapy)\b/i,
  ],
  ['financial', /\b(salary|debt|loan|mortgage|bank|income|credit score|invest\w*)\b/i],
];

/**
 * Deterministic write-time screen. Runs before anything is stored or sent to a model:
 * clauses with blocked content are dropped whole, and what remains gets sensitivity tags.
 */
export function screen(text: string): Screened {
  const redactions = new Set<BlockedCategory>();
  const kept: string[] = [];
  for (const clause of text.match(/[^.!?;,\n]+[.!?;,\n]*/g) ?? []) {
    const hits = BLOCKERS.filter(([, blocks]) => blocks(clause)).map(([category]) => category);
    if (hits.length === 0) kept.push(clause);
    for (const hit of hits) redactions.add(hit);
  }
  const clean = kept
    .join('')
    .replace(/\s+/g, ' ')
    .replace(/[,;\s]+$/, '')
    .trim();
  return { text: clean, redactions: [...redactions], tags: tagsFor(clean) };
}

export function tagsFor(text: string): SensitivityTag[] {
  return TAGGERS.filter(([, pattern]) => pattern.test(text)).map(([tag]) => tag);
}

function hasCardNumber(clause: string): boolean {
  for (const match of clause.matchAll(/\d(?:[ -]?\d){12,18}/g)) {
    if (luhn(match[0].replace(/\D/g, ''))) return true;
  }
  return false;
}

function luhn(digits: string): boolean {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}
