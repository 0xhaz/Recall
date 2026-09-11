import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { temporalStamp } from '@recall/core';
import * as z from 'zod';
import type { HouseholdContext } from '../auth/household-auth.js';
import type { DeviceService } from '../devices/device.service.js';
import { type EventLog, SYNC_PAGE } from '../events/event-log.service.js';
import type { MemoryService } from '../memory/memory.service.js';
import { SESSION_TTL_MINUTES, type SessionService } from '../sessions/session.service.js';
import { DEVICE_ID, deviceArg, json, type Timed } from './tool-kit.js';

/** Knowing only the device is a guess, kept below the speaker-confidence threshold on purpose. */
const DEVICE_GUESS_CONFIDENCE = 0.5;

export interface DeviceToolDeps {
  memory: MemoryService;
  events: EventLog;
  devices: DeviceService;
  sessions: SessionService;
}

const incomingEvent = z.object({
  event_id: z.string().describe('A UUID generated on the device; resending the same id is harmless.'),
  hlc: z.string().describe('Hybrid logical clock stamp: <13-digit ms>-<5-digit counter>-<device id>.'),
  kind: z.string().describe('e.g. media.play, timer.start, notification.subscribe, session.turn, hr.sample'),
  person: z.string().optional().describe('Who it concerns, by name or person id, if the device knows.'),
  person_confidence: z.number().min(0).max(1).optional(),
  location: z.string().max(80).optional(),
  payload: z.record(z.string(), z.unknown()).optional(),
});

export function registerDeviceTools(
  server: McpServer,
  ctx: HouseholdContext,
  deps: DeviceToolDeps,
  timed: Timed,
): void {
  const { memory, events, devices, sessions } = deps;

  const stamp = async () => {
    const household = await memory.household(ctx.householdId);
    if (!household) throw new Error('Household not found');
    return temporalStamp(household.timezone);
  };

  server.registerTool(
    'ingest_events',
    {
      title: 'Ingest device events',
      description:
        'For devices, not assistants. Report what happened on a device: media, timers, alarms, notification ' +
        'subscriptions, features, conversation turns (session.open / session.turn / session.close) and sensor ' +
        'readings. Idempotent by event_id; ordered by HLC. Memory changes cannot be written this way.',
      inputSchema: {
        device: z.object({
          id: z.string().regex(DEVICE_ID),
          name: z.string().max(80).optional(),
          location: z.string().max(80).optional(),
        }),
        events: z.array(incomingEvent).min(1).max(500),
      },
    },
    ({ device, events: batch }) => timed('ingest_events', async () => json(await events.ingest(ctx, device, batch))),
  );

  server.registerTool(
    'sync',
    {
      title: 'Sync',
      description:
        "For devices. Pull the household's events after your cursor to keep a local memory view. mode 'replay' returns " +
        "events in order; mode 'snapshot' means your cursor is older than the kept log: start from the snapshot, then keep " +
        'syncing from next_cursor. Repeat while has_more is true.',
      inputSchema: {
        device: z.string().regex(DEVICE_ID),
        cursor: z.number().int().min(0).default(0),
        limit: z.number().int().min(1).max(500).default(SYNC_PAGE),
      },
      annotations: { readOnlyHint: true },
    },
    ({ device, cursor, limit }) => timed('sync', async () => json(await events.sync(ctx, device, cursor, limit))),
  );

  server.registerTool(
    'device_state',
    {
      title: 'Device state',
      description:
        'The only source for what is playing, running timers and alarms, notification subscriptions and enabled ' +
        'features. Call it before answering any question about them, and again after changing one to confirm the ' +
        'change took effect. Never answer these from memory.',
      inputSchema: { device: deviceArg },
      annotations: { readOnlyHint: true },
    },
    ({ device }) =>
      timed('device_state', async () => {
        const [temporal, list] = await Promise.all([stamp(), devices.state(ctx.householdId, device)]);
        return json({ temporal, devices: list });
      }),
  );

  server.registerTool(
    'session_history',
    {
      title: 'Session history',
      description:
        'The actual log of the conversation. Call it before claiming anything about what you or the user said ' +
        'earlier ("I already told you…"); never answer that from memory.',
      inputSchema: {
        session_id: z.string().uuid().optional(),
        device: deviceArg,
      },
      annotations: { readOnlyHint: true },
    },
    ({ session_id, device }) =>
      timed('session_history', async () => {
        const [temporal, session] = await Promise.all([
          stamp(),
          session_id || device ? sessions.history(ctx.householdId, { sessionId: session_id, deviceId: device }) : null,
        ]);
        return json({
          temporal,
          session,
          ...(session
            ? {}
            : { message: `No conversation on record for this device in the last ${SESSION_TTL_MINUTES} minutes.` }),
        });
      }),
  );

  server.registerTool(
    'resolve_speaker',
    {
      title: 'Resolve speaker',
      description:
        'For devices (simulated Voice ID): who is speaking, from what the device knows — a recognised voice profile with ' +
        "its match score, or just the device. Pass the result's speaker and confidence on to the other tools. A device's " +
        'usual person is only a guess: it comes back as a candidate to confirm, never as the speaker.',
      inputSchema: {
        name: z.string().max(80).optional().describe('The voice profile the device matched, if any.'),
        confidence: z.number().min(0).max(1).optional().describe('The match score for that profile.'),
        device: deviceArg,
      },
      annotations: { readOnlyHint: true },
    },
    ({ name, confidence, device }) =>
      timed('resolve_speaker', async () => {
        if (name) {
          const identity = await memory.identify(ctx.householdId, name, confidence ?? 1);
          const who = identity.speaker;
          if (who) {
            return json({
              speaker: { id: who.person_id, name: who.display_name, role: who.role },
              confidence: who.confidence,
              source: 'voice',
            });
          }
          if (identity.candidate) {
            return json({
              speaker: null,
              speaker_candidate: identity.candidate,
              confidence: confidence ?? null,
              source: 'voice',
              message: 'Weak voice match: confirm who is speaking before using anything personal.',
            });
          }
        }
        const usual = device ? await devices.primaryPerson(ctx.householdId, device) : null;
        if (usual) {
          const identity = await memory.identify(ctx.householdId, usual, DEVICE_GUESS_CONFIDENCE);
          const candidate = identity.candidate ?? identity.speaker?.display_name;
          if (candidate) {
            return json({
              speaker: null,
              speaker_candidate: candidate,
              confidence: DEVICE_GUESS_CONFIDENCE,
              source: 'device',
              message: `This is usually ${candidate}'s device: confirm before using anything personal.`,
            });
          }
        }
        return json({
          speaker: null,
          confidence: 0,
          source: 'unknown',
          message: 'Nobody recognised: ask who is speaking.',
        });
      }),
  );
}
