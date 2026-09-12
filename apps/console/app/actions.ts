'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import {
  ApiError,
  correctFact,
  decideRoutine,
  forgetFact,
  removeRule,
  requestMagicLink,
  setCarePolicy,
  setRetention,
  undoAction,
} from '@/lib/recall';
import { endSession } from '@/lib/session';

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
