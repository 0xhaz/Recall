import { sessionToken } from './session';

// Every call to Recall happens here, on the server, with the signed-in person's session token.
// The console has no privileges of its own: what a page can show is what that person may see.

const API = process.env.RECALL_API_URL ?? 'http://127.0.0.1:3100';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

interface Options {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  /** For sign-in, before there is a session. */
  token?: string | null;
}

export async function call<T>(path: string, options: Options = {}): Promise<T> {
  const token = options.token === undefined ? await sessionToken() : options.token;
  const res = await fetch(`${API}${path}`, {
    method: options.method ?? 'GET',
    cache: 'no-store',
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });
  const text = await res.text();
  const body: unknown = text ? JSON.parse(text) : {};
  if (!res.ok) {
    const message = (body as { message?: string | string[] }).message;
    throw new ApiError(res.status, Array.isArray(message) ? message.join(', ') : (message ?? res.statusText));
  }
  return body as T;
}

// ---------------------------------------------------------------- what the API returns

export type Role = 'owner' | 'adult' | 'child' | 'guest' | 'caregiver' | 'cared_for';

export interface Profile {
  id: string;
  display_name: string;
  email: string | null;
  memberships: { household_id: string; household_name: string; role: Role; grants: string[]; capacity_flag: boolean }[];
}

export interface Fact {
  id: string;
  content: string;
  scope: 'person' | 'household' | 'device';
  scope_name: string | null;
  type: string;
  confidence: number;
  sensitivity: string;
  source: { origin?: string; entered_by?: string; corrected_from?: string; device_id?: string };
  said_by: string | null;
  valid_from: string;
  valid_to: string | null;
  expires_at: string | null;
  forgotten_at: string | null;
  superseded_by: string | null;
  editable: boolean;
  deletable: boolean;
}

export interface Rule {
  id: string;
  text: string;
  summary: string;
  applies_to: string;
  author: string | null;
  severity: string;
  effect: string;
  expires_at: string | null;
}

export interface BlockedAction {
  action_id: string;
  summary: string;
  intent: string;
  person: string | null;
  at: string;
  rule: { rule_id: string; text: string } | null;
  withheld: { reason: string } | null;
}

export interface Routine {
  id: string;
  person: string | null;
  kind: string;
  days: string;
  center_minute: number;
  spread_minutes: number;
  shifted_from: number | null;
  support: number;
  confidence: number;
  last_seen: string | null;
  sequence: string[];
  status: 'candidate' | 'offered' | 'active' | 'retired';
  health: 'ok' | 'fading' | 'broken';
  health_reason: string | null;
  accepted: number;
  dismissed: number;
}

export interface Action {
  id: string;
  person: string | null;
  intent: string;
  summary: string;
  status: string;
  tier: string;
  proactive: boolean;
  source: { type?: string; text?: string } | null;
  decision: string | null;
  confirmed: string[];
  blocked_by: { text: string } | null;
  at: string;
  decided_at: string | null;
  undo_until: string | null;
  undoable: boolean;
}

export interface ContextView {
  context: string;
  for: string;
  score: number;
  active: boolean;
  since: string | null;
  manual: boolean;
  reasons: string[];
}

export interface ContextReading {
  contexts: ContextView[];
  quiet_hours: { active: boolean; because: string[] };
  thresholds: { person: string; resting_hr: number | null; ratio: number | null }[];
}

export interface Device {
  device_id: string;
  name: string | null;
  location: string | null;
  primary_person: string | null;
  first_seen_at: string;
  last_seen_at: string;
  last_cursor: number;
  state: { now_playing?: { title: string; paused: boolean } | null; timers?: unknown[] } | null;
}

export interface Person {
  person_id: string;
  name: string;
  role: Role;
  grants: string[];
  capacity_flag: boolean;
  sees: string;
}

export interface Notice {
  id: string;
  kind: string;
  audience: string;
  text: string;
  person: string | null;
  device_id: string | null;
  created_at: string;
  acknowledged_at: string | null;
}

export interface Settings {
  name: string;
  timezone: string;
  region: string;
  retention_days: number;
}

export interface Overview {
  counts: {
    facts: number;
    forgotten: number;
    rules: number;
    routines: number;
    candidates: number;
    broken: number;
    actions_today: number;
    blocked_today: number;
    pending: number;
  };
  household: Settings;
  contexts: ContextView[];
  quiet_hours: { active: boolean; because: string[] };
}

export interface CarePolicy {
  topic: string;
  keywords: string[];
  policy: 'correct' | 'redirect';
  guidance: string | null;
  set_by: 'default' | 'caregiver';
}

export type ReminderKind = 'medication' | 'meal' | 'other';

export interface Reminder {
  id: string;
  kind: ReminderKind;
  label: string;
  dose: string | null;
  times: string[];
  days: 'daily' | 'weekdays' | 'weekends';
  device_id: string | null;
  grace_minutes: number;
  escalate_after_minutes: number;
}

export interface DueDose {
  log_id: string | null;
  reminder_id: string;
  label: string;
  dose: string | null;
  kind: ReminderKind;
  due: string;
  status: 'pending' | 'confirmed' | 'missed' | 'skipped' | 'not_due';
  confirmed_at: string | null;
  how: 'voice' | 'console' | null;
  note: string | null;
  by: string | null;
}

/** What a worn tracker reports. Readings, never a diagnosis. */
export interface Vitals {
  device: string | null;
  bpm: number | null;
  resting: number | null;
  at: string | null;
  moving: boolean | null;
  moved_at: string | null;
}

export interface CarePlan {
  person: { id: string; name: string };
  can_edit: boolean;
  policies: CarePolicy[];
  reminders: Reminder[];
  doses: DueDose[];
  vitals: Vitals | null;
  day: { kind: string; at: string; ok: boolean }[];
  alerts: { kind: string; text: string; at: string; acknowledged_at: string | null }[];
}

// ---------------------------------------------------------------- reads

const household = (id: string) => `/console/households/${encodeURIComponent(id)}`;

export const getProfile = () => call<Profile>('/me');
export const getOverview = (id: string) => call<Overview>(`${household(id)}/overview`);
export const getRules = (id: string) => call<{ rules: Rule[]; blocked: BlockedAction[] }>(`${household(id)}/rules`);
export const getRoutines = (id: string) => call<{ routines: Routine[] }>(`${household(id)}/routines`);
export const getActions = (id: string) => call<{ actions: Action[] }>(`${household(id)}/actions?limit=50`);
export const getContext = (id: string) => call<ContextReading>(`${household(id)}/context`);
export const getDevices = (id: string) => call<{ devices: Device[] }>(`${household(id)}/devices`);
export const getPeople = (id: string) => call<{ people: Person[] }>(`${household(id)}/people`);
export const getNotices = (id: string) => call<{ notices: Notice[] }>(`${household(id)}/notices`);
export const getSettings = (id: string) => call<Settings>(`${household(id)}/settings`);
export const getCarePlan = (id: string, personId: string) =>
  call<CarePlan>(`${household(id)}/care/${encodeURIComponent(personId)}`);
export const getExport = (id: string) => call<Record<string, unknown>>(`${household(id)}/export`);

export function getFacts(
  id: string,
  filters: { query?: string; state?: string; person?: string } = {},
): Promise<{ facts: Fact[] }> {
  const params = new URLSearchParams();
  if (filters.query) params.set('query', filters.query);
  if (filters.state && filters.state !== 'current') params.set('state', filters.state);
  if (filters.person) params.set('person', filters.person);
  const query = params.toString();
  return call<{ facts: Fact[] }>(`${household(id)}/facts${query ? `?${query}` : ''}`);
}

// ---------------------------------------------------------------- writes

export const correctFact = (id: string, factId: string, content: string) =>
  call<{ corrected: string; content: string }>(`${household(id)}/facts/${factId}`, {
    method: 'PATCH',
    body: { content },
  });

export const forgetFact = (id: string, factId: string) =>
  call<{ forgotten: string[] }>(`${household(id)}/facts/${factId}`, { method: 'DELETE' });

export const removeRule = (id: string, ruleId: string) =>
  call<{ removed?: boolean; message: string }>(`${household(id)}/rules/${ruleId}`, { method: 'DELETE' });

export const decideRoutine = (id: string, routineId: string, decision: 'accept' | 'dismiss') =>
  call<{ status: string }>(`${household(id)}/routines/${routineId}`, { method: 'POST', body: { decision } });

export const undoAction = (id: string, actionId: string) =>
  call<{ status?: string; message: string }>(`${household(id)}/actions/${actionId}/undo`, { method: 'POST' });

export const setRetention = (id: string, days: number) =>
  call<Settings>(`${household(id)}/settings`, { method: 'PATCH', body: { retention_days: days } });

export const setCarePolicy = (id: string, body: Record<string, unknown>) =>
  call<{ saved: boolean; message: string }>(`${household(id)}/care/policies`, { method: 'POST', body });

export const setReminder = (id: string, body: Record<string, unknown>) =>
  call<{ saved: boolean; id: string }>(`${household(id)}/care/reminders`, { method: 'POST', body });

export const removeReminder = (id: string, reminderId: string) =>
  call<{ removed: boolean }>(`${household(id)}/care/reminders/${encodeURIComponent(reminderId)}`, { method: 'DELETE' });

export const confirmDose = (id: string, logId: string, note?: string) =>
  call<{ confirmed: boolean; message: string }>(`${household(id)}/care/doses/${encodeURIComponent(logId)}/confirm`, {
    method: 'POST',
    body: note ? { note } : {},
  });

// ---------------------------------------------------------------- sign-in

export const requestMagicLink = (email: string) =>
  call<{ ok: boolean }>('/auth/magic-link', { method: 'POST', body: { email }, token: null });

export const verifyMagicLink = (token: string) =>
  call<{ session_token: string; expires_at: string }>('/auth/verify', {
    method: 'POST',
    body: { token },
    token: null,
  });
