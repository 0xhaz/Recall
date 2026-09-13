// Wording for medication and meal reminders. Plain, warm, and never a claim about health: Recall
// says what the caregiver wrote down and what the person answered, nothing more.

export function reminderName(label: string, dose: string | null): string {
  return dose ? `${label} (${dose})` : label;
}

/** Said to the person, on their device. */
export function reminderPrompt(name: string, label: string, dose: string | null, kind: string): string {
  if (kind === 'meal') return `${name}, it's time for ${label}.`;
  return `${name}, it's time for your ${reminderName(label, dose)}. Say "taken" when you have.`;
}

/** Said again, gently, while it is still unanswered. */
export function reminderNudge(name: string, label: string, dose: string | null): string {
  return `${name}, just a reminder about your ${reminderName(label, dose)}.`;
}

/** Sent to the carers once it has gone unanswered long enough. */
export function reminderMissedText(name: string, label: string, due: string, asked: string): string {
  return `${name} hasn't confirmed ${label}, due at ${due}. Asked at ${asked}, no answer yet.`;
}

/** Sent to the carers when it is confirmed: the point of the whole thing. */
export function reminderConfirmedText(
  name: string,
  label: string,
  time: string,
  how: 'voice' | 'console',
  by: string | null,
): string {
  if (how === 'console') return `${by ?? 'A caregiver'} recorded ${name}'s ${label} as taken (${time}).`;
  return `${name} confirmed ${label} at ${time}.`;
}

/** What the person hears back when they confirm. */
export function reminderThanks(label: string): string {
  return `Thank you, I've noted your ${label}.`;
}
