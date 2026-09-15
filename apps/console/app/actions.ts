'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import {
  ApiError,
  addPerson,
  confirmDose,
  correctFact,
  decideRoutine,
  forgetFact,
  forgetRange,
  pauseHousehold,
  removePerson,
  removeReminder,
  removeRule,
  requestMagicLink,
  setCarePolicy,
  setReminder,
  setRetention,
  undoAction,
} from '@/lib/recall';
import { endSession } from '@/lib/session';
import { getSimDevices, type SimDevice, type SimReply, SimulatorOffline, saySomething } from '@/lib/simulator';

// Everything the console changes goes through here: a server action, the person's own session,
// and a revalidate so the page shows what Recall now holds rather than what the browser had.

export interface ActionState {
  error?: string;
  message?: string;
}

const text = (form: FormData, field: string) => String(form.get(field) ?? '').trim();

async function run(path: string, work: () => Promise<string>): Promise<ActionState> {
  try {
    const message = await work();
    revalidatePath(path);
    return { message };
  } catch (err) {
    if (err instanceof ApiError) return { error: err.message };
    throw err;
  }
}

export interface SayState {
  error?: string;
  offline?: boolean;
  said?: string;
  speaker?: string | null;
  device?: string;
  reply?: SimReply;
  devices?: SimDevice[];
}

/**
 * Speak to the simulated assistant. It answers through Recall over MCP, so anything it remembers or
 * does shows up on the other console pages too — hence the revalidate.
 */
export async function sayAction(_state: SayState, form: FormData): Promise<SayState> {
  const household = text(form, 'household');
  const said = text(form, 'text');
  const device = text(form, 'device');
  const speaker = text(form, 'speaker') || null;
  const confidence = Number(form.get('confidence') ?? 1);
  if (!said) return { error: 'Say something first' };

  try {
    const reply = await saySomething({
      device,
      speaker,
      confidence: Number.isFinite(confidence) ? confidence : 1,
      text: said,
    });
    const devices = await getSimDevices().catch(() => null);
    revalidatePath(`/h/${household}`, 'layout');
    return { said, speaker, device, reply, ...(devices ? { devices: devices.devices } : {}) };
  } catch (err) {
    if (err instanceof SimulatorOffline) return { offline: true, error: err.message };
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

export async function requestLinkAction(_state: ActionState, form: FormData): Promise<ActionState> {
  const email = text(form, 'email');
  if (!email) return { error: 'Enter the email address you were invited with' };
  try {
    await requestMagicLink(email);
  } catch (err) {
    if (err instanceof ApiError) return { error: err.message };
    throw err;
  }
  // Always the same answer, whether or not the address is known: accounts can't be fished for.
  return { message: `If ${email} belongs to someone here, a sign-in link is on its way.` };
}

export async function signOutAction(): Promise<void> {
  await endSession();
  redirect('/sign-in');
}

export async function correctFactAction(_state: ActionState, form: FormData): Promise<ActionState> {
  const household = text(form, 'household');
  const factId = text(form, 'fact');
  const content = text(form, 'content');
  if (content.length < 3) return { error: 'Say what it should be instead' };
  return run(`/h/${household}/memory`, async () => {
    const { content: saved } = await correctFact(household, factId, content);
    return `Corrected: “${saved}”. The old wording is kept as history, and every device has been told.`;
  });
}

export async function forgetFactAction(_state: ActionState, form: FormData): Promise<ActionState> {
  const household = text(form, 'household');
  const factId = text(form, 'fact');
  return run(`/h/${household}/memory`, async () => {
    const { forgotten } = await forgetFact(household, factId);
    return `Forgotten on every device${forgotten.length > 1 ? `, along with ${forgotten.length - 1} superseded version(s)` : ''}.`;
  });
}

export async function removeRuleAction(_state: ActionState, form: FormData): Promise<ActionState> {
  const household = text(form, 'household');
  const ruleId = text(form, 'rule');
  return run(`/h/${household}/rules`, async () => (await removeRule(household, ruleId)).message);
}

export async function decideRoutineAction(_state: ActionState, form: FormData): Promise<ActionState> {
  const household = text(form, 'household');
  const routineId = text(form, 'routine');
  const decision = text(form, 'decision') === 'accept' ? 'accept' : 'dismiss';
  return run(`/h/${household}/routines`, async () => {
    const { status } = await decideRoutine(household, routineId, decision);
    return decision === 'accept' ? 'Accepted: it can be offered from now on.' : `Dismissed (${status}).`;
  });
}

export async function undoActionAction(_state: ActionState, form: FormData): Promise<ActionState> {
  const household = text(form, 'household');
  const actionId = text(form, 'action');
  return run(`/h/${household}/actions`, async () => (await undoAction(household, actionId)).message);
}

export async function setRetentionAction(_state: ActionState, form: FormData): Promise<ActionState> {
  const household = text(form, 'household');
  const days = Number(text(form, 'retention_days'));
  if (!Number.isInteger(days) || days < 7 || days > 365) return { error: 'Choose between 7 and 365 days' };
  return run(`/h/${household}/settings`, async () => {
    const saved = await setRetention(household, days);
    return `Raw events are now kept ${saved.retention_days} days. Anything forgotten stays forgotten.`;
  });
}

export async function addPersonAction(_state: ActionState, form: FormData): Promise<ActionState> {
  const household = text(form, 'household');
  const name = text(form, 'name');
  const email = text(form, 'email');
  const role = text(form, 'role');
  if (!name) return { error: 'Give them a name' };
  return run(`/h/${household}/people`, async () => {
    const added = await addPerson(household, { name, email: email || null, role });
    return `${added.name} is in the household as ${added.role.replace('_', ' ')}.`;
  });
}

export async function removePersonAction(_state: ActionState, form: FormData): Promise<ActionState> {
  const household = text(form, 'household');
  const subject = text(form, 'person_id');
  return run(`/h/${household}/people`, async () => {
    const gone = await removePerson(household, subject);
    // Revoked, not deleted: what they said stays theirs, and forget is how it goes.
    return `${gone.name} was removed. Anything they told Recall is still theirs to forget.`;
  });
}

export async function forgetRangeAction(_state: ActionState, form: FormData): Promise<ActionState> {
  const household = text(form, 'household');
  const from = text(form, 'from');
  const to = text(form, 'to');
  if (!from || !to) return { error: 'Choose both dates' };
  if (from > to) return { error: 'That range ends before it starts' };
  return run(`/h/${household}/settings`, async () => {
    const done = await forgetRange(household, from, to);
    return done.forgotten === 0
      ? `Nothing was recorded between ${from} and ${to}.`
      : `${done.forgotten} ${done.forgotten === 1 ? 'fact' : 'facts'} forgotten, on every device. It cannot be undone.`;
  });
}

export async function pauseAction(_state: ActionState, form: FormData): Promise<ActionState> {
  const household = text(form, 'household');
  const minutes = Number(text(form, 'minutes'));
  if (!Number.isInteger(minutes) || minutes < 0 || minutes > 720) return { error: 'Choose up to 12 hours' };
  return run(`/h/${household}/settings`, async () => {
    const paused = await pauseHousehold(household, minutes);
    return paused.paused_until
      ? `Paused until ${new Date(paused.paused_until).toLocaleTimeString()}. Nothing is read or stored until then.`
      : 'Recall is listening again.';
  });
}

export async function setCarePolicyAction(_state: ActionState, form: FormData): Promise<ActionState> {
  const household = text(form, 'household');
  const person = text(form, 'person');
  const topic = text(form, 'topic');
  const keywords = text(form, 'keywords')
    .split(',')
    .map((k) => k.trim())
    .filter(Boolean);
  const policy = text(form, 'policy') === 'correct' ? 'correct' : 'redirect';
  const guidance = text(form, 'guidance');
  const remove = text(form, 'remove') === 'true';
  if (!topic) return { error: 'Name the topic this is about' };
  return run(`/h/${household}/care`, async () => {
    const saved = await setCarePolicy(household, {
      person,
      topic,
      policy,
      ...(keywords.length > 0 ? { keywords } : {}),
      ...(guidance ? { guidance } : {}),
      ...(remove ? { remove } : {}),
    });
    return saved.message;
  });
}

export async function setReminderAction(_state: ActionState, form: FormData): Promise<ActionState> {
  const household = text(form, 'household');
  const person = text(form, 'person');
  const label = text(form, 'label');
  const dose = text(form, 'dose');
  const times = text(form, 'times')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
  const days = text(form, 'days');
  const escalate = Number(text(form, 'escalate'));
  if (!label) return { error: 'Say what is being taken' };
  if (times.length === 0) return { error: 'Give at least one time of day, like 08:00' };
  if (!times.every((t) => /^([01]?\d|2[0-3]):[0-5]\d$/.test(t))) return { error: 'Write times as HH:MM, like 08:00' };

  return run(`/h/${household}/care/${person}`, async () => {
    await setReminder(household, {
      person,
      label,
      times,
      ...(dose ? { dose } : {}),
      ...(days === 'weekdays' || days === 'weekends' ? { days } : {}),
      ...(Number.isInteger(escalate) && escalate >= 5 ? { escalate_after_minutes: escalate } : {}),
    });
    return `Saved. ${label} at ${times.join(', ')} — she will be asked on her own device, and nobody else is told unless she doesn't answer.`;
  });
}

export async function removeReminderAction(_state: ActionState, form: FormData): Promise<ActionState> {
  const household = text(form, 'household');
  const reminderId = text(form, 'reminder');
  return run(`/h/${household}/care`, async () => {
    const { removed } = await removeReminder(household, reminderId);
    return removed ? 'Removed from the schedule. Doses already recorded are kept.' : 'That reminder was already gone.';
  });
}

export async function confirmDoseAction(_state: ActionState, form: FormData): Promise<ActionState> {
  const household = text(form, 'household');
  const logId = text(form, 'dose');
  const note = text(form, 'note');
  return run(`/h/${household}/care`, async () => {
    const result = await confirmDose(household, logId, note || undefined);
    return result.message;
  });
}
