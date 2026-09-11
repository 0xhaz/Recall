import { describe, expect, it } from 'vitest';
import { type DeviceState, describeDeviceState, emptyDeviceState, reduceDeviceState } from './device-state.js';
import { formatHlc } from './hlc.js';

const T0 = Date.parse('2026-09-11T11:00:00Z');
const at = (seconds: number, counter = 0) => formatHlc({ wall: T0 + seconds * 1000, counter, node: 'kitchen' });

function run(events: [string, number, Record<string, unknown>][]): DeviceState {
  return events.reduce(
    (state, [kind, seconds, payload]) => reduceDeviceState(state, { kind, hlc: at(seconds), payload }),
    emptyDeviceState(),
  );
}

describe('device state', () => {
  it('reports now playing, and stop clears it', () => {
    const playing = run([['media.play', 0, { title: 'Running mix', source: 'Music' }]]);
    expect(describeDeviceState(playing).now_playing).toMatchObject({ title: 'Running mix', paused: false });

    const stopped = run([
      ['media.play', 0, { title: 'Running mix' }],
      ['media.stop', 5, {}],
    ]);
    expect(describeDeviceState(stopped).now_playing).toBeNull();
  });

  it('computes remaining time from when the timer actually started', () => {
    const state = run([['timer.start', 0, { timer_id: 'pasta', duration_s: 600, label: 'pasta' }]]);
    const view = describeDeviceState(state, new Date(T0 + 90_000));
    expect(view.timers).toEqual([
      { id: 'pasta', label: 'pasta', duration_s: 600, started_at: '2026-09-11T11:00:00.000Z', remaining_s: 510 },
    ]);
    expect(describeDeviceState(state, new Date(T0 + 700_000)).timers).toEqual([]);
  });

  it('ignores a late report that is older than what it would overwrite', () => {
    const state = run([
      ['timer.start', 0, { timer_id: 't1', duration_s: 600 }],
      ['timer.cancel', 30, { timer_id: 't1' }],
      ['timer.start', 10, { timer_id: 't1', duration_s: 600 }], // delayed duplicate of an older start
      ['notification.subscribe', 0, { topic: 'deliveries' }],
      ['notification.unsubscribe', 20, { topic: 'deliveries' }],
      ['notification.subscribe', 5, { topic: 'deliveries' }], // stale
    ]);
    const view = describeDeviceState(state, new Date(T0 + 60_000));
    expect(view.timers).toEqual([]);
    expect(view.notifications).toEqual([]);
  });

  it('keeps a cancel that arrives before its start', () => {
    const state = run([
      ['timer.cancel', 30, { timer_id: 't2' }],
      ['timer.start', 0, { timer_id: 't2', duration_s: 600 }],
    ]);
    expect(describeDeviceState(state, new Date(T0 + 60_000)).timers).toEqual([]);
  });

  it('lists enabled features and future alarms', () => {
    const state = run([
      ['feature.enable', 0, { feature: 'quiet_hours' }],
      ['alarm.set', 0, { alarm_id: 'wake', at: '2026-09-12T06:30:00+08:00', label: 'wake up' }],
      ['alarm.set', 1, { alarm_id: 'old', at: '2026-09-10T06:30:00+08:00' }],
    ]);
    const view = describeDeviceState(state, new Date(T0));
    expect(view.features).toEqual(['quiet_hours']);
    expect(view.alarms).toEqual([{ id: 'wake', at: '2026-09-11T22:30:00.000Z', label: 'wake up' }]);
  });

  it('ignores malformed reports', () => {
    const state = run([
      ['timer.start', 0, { duration_s: 60 }],
      ['media.play', 0, {}],
    ]);
    expect(describeDeviceState(state)).toEqual({
      now_playing: null,
      timers: [],
      alarms: [],
      notifications: [],
      features: [],
    });
  });
});
