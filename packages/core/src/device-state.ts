import { hlcWallTime } from './hlc.js';

// Live device state as reported by the device itself: the only source the assistant may use
// to answer questions about state (architecture.md §5, state-of-record principle).
// Every key is last-writer-wins by HLC, so late or out-of-order reports can't undo newer ones.

interface Stamped {
  hlc: string;
}

export interface NowPlaying {
  title: string;
  artist: string | null;
  source: string | null;
  since: string;
  paused: boolean;
}

export interface DeviceState {
  media: (Stamped & { playing: NowPlaying | null }) | null;
  timers: Record<string, Stamped & { label: string | null; duration_s: number; started_at: string; active: boolean }>;
  alarms: Record<string, Stamped & { at: string; label: string | null; active: boolean }>;
  notifications: Record<string, Stamped & { subscribed: boolean }>;
  features: Record<string, Stamped & { enabled: boolean }>;
}

export interface DeviceStateView {
  now_playing: NowPlaying | null;
  timers: { id: string; label: string | null; duration_s: number; started_at: string; remaining_s: number }[];
  alarms: { id: string; at: string; label: string | null }[];
  notifications: string[];
  features: string[];
}

export const DEVICE_STATE_KIND = /^(media|timer|alarm|notification|feature)\./;

export function emptyDeviceState(): DeviceState {
  return { media: null, timers: {}, alarms: {}, notifications: {}, features: {} };
}

/** Stored state as read from the database: a device that never reported anything has `{}`. */
export function asDeviceState(value: unknown): DeviceState {
  return value && typeof value === 'object' && 'timers' in value ? (value as DeviceState) : emptyDeviceState();
}

const newer = (current: Stamped | null | undefined, hlc: string) => !current || current.hlc < hlc;
const text = (value: unknown): string | null => (typeof value === 'string' && value.trim() ? value.trim() : null);
const isoTime = (value: unknown): string | null => {
  const t = text(value);
  return t && !Number.isNaN(Date.parse(t)) ? new Date(t).toISOString() : null;
};

export function reduceDeviceState(
  state: DeviceState,
  event: { kind: string; hlc: string; payload: Record<string, unknown> },
): DeviceState {
  const next = structuredClone(state);
  const at = hlcWallTime(event.hlc)?.toISOString() ?? new Date().toISOString();
  const p = event.payload;
  const { hlc } = event;

  switch (event.kind) {
    case 'media.play':
    case 'media.pause': {
      const title = text(p.title);
      if (!title || !newer(next.media, hlc)) break;
      const paused = event.kind === 'media.pause';
      const since = next.media?.playing?.title === title ? next.media.playing.since : at;
      next.media = { hlc, playing: { title, artist: text(p.artist), source: text(p.source), since, paused } };
      break;
    }
    case 'media.stop':
      if (newer(next.media, hlc)) next.media = { hlc, playing: null };
      break;
    case 'timer.start': {
      const id = text(p.timer_id);
      const duration = Number(p.duration_s);
      if (!id || !(duration > 0) || !newer(next.timers[id], hlc)) break;
      next.timers[id] = {
        hlc,
        label: text(p.label),
        duration_s: duration,
        started_at: isoTime(p.started_at) ?? at,
        active: true,
      };
      break;
    }
    case 'timer.cancel':
    case 'timer.done': {
      const id = text(p.timer_id);
      if (!id || !newer(next.timers[id], hlc)) break;
      // Recorded even if the start hasn't arrived yet, so a late start can't revive it.
      const timer = next.timers[id];
      next.timers[id] = timer
        ? { ...timer, hlc, active: false }
        : { hlc, label: null, duration_s: 0, started_at: at, active: false };
      break;
    }
    case 'alarm.set': {
      const id = text(p.alarm_id);
      const when = isoTime(p.at);
      if (!id || !when || !newer(next.alarms[id], hlc)) break;
      next.alarms[id] = { hlc, at: when, label: text(p.label), active: true };
      break;
    }
    case 'alarm.cancel': {
      const id = text(p.alarm_id);
      if (!id || !newer(next.alarms[id], hlc)) break;
      const alarm = next.alarms[id];
      next.alarms[id] = alarm ? { ...alarm, hlc, active: false } : { hlc, at, label: null, active: false };
      break;
    }
    case 'notification.subscribe':
    case 'notification.unsubscribe': {
      const topic = text(p.topic);
      if (topic && newer(next.notifications[topic], hlc)) {
        next.notifications[topic] = { hlc, subscribed: event.kind === 'notification.subscribe' };
      }
      break;
    }
    case 'feature.enable':
    case 'feature.disable': {
      const feature = text(p.feature);
      if (feature && newer(next.features[feature], hlc)) {
        next.features[feature] = { hlc, enabled: event.kind === 'feature.enable' };
      }
      break;
    }
  }
  return next;
}

/** What is true on the device right now: running timers with time left, future alarms, subscriptions. */
export function describeDeviceState(state: DeviceState, now: Date = new Date()): DeviceStateView {
  const timers = Object.entries(state.timers)
    .filter(([, t]) => t.active)
    .map(([id, t]) => ({
      id,
      label: t.label,
      duration_s: t.duration_s,
      started_at: t.started_at,
      remaining_s: Math.ceil((Date.parse(t.started_at) + t.duration_s * 1000 - now.getTime()) / 1000),
    }))
    .filter((t) => t.remaining_s > 0)
    .sort((a, b) => a.remaining_s - b.remaining_s);

  const alarms = Object.entries(state.alarms)
    .filter(([, a]) => a.active && Date.parse(a.at) > now.getTime())
    .map(([id, a]) => ({ id, at: a.at, label: a.label }))
    .sort((a, b) => a.at.localeCompare(b.at));

  const on = (entries: Record<string, { hlc: string }>, flag: 'subscribed' | 'enabled') =>
    Object.entries(entries)
      .filter(([, value]) => (value as Record<string, unknown>)[flag] === true)
      .map(([key]) => key)
      .sort();

  return {
    now_playing: state.media?.playing ?? null,
    timers,
    alarms,
    notifications: on(state.notifications, 'subscribed'),
    features: on(state.features, 'enabled'),
  };
}
