import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { temporalStamp } from '@recall/core';
import * as z from 'zod';
import type { HouseholdContext } from '../auth/household-auth.js';
import type { DeviceService } from '../devices/device.service.js';
import type { MemoryService } from '../memory/memory.service.js';
import type { SessionService } from '../sessions/session.service.js';
import { deviceArg, json, speakerArgs, type Timed } from './tool-kit.js';

// Sections of session_brief that later weeks fill in. Listed explicitly so the model
// knows they are absent rather than inventing them.
const NOT_YET_AVAILABLE = ['rules', 'context_scores', 'quiet_hours'];
const HANDOFF_TURNS = 6;

export interface MemoryToolDeps {
  memory: MemoryService;
  devices: DeviceService;
  sessions: SessionService;
}

export function registerMemoryTools(
  server: McpServer,
  ctx: HouseholdContext,
  deps: MemoryToolDeps,
  timed: Timed,
): void {
  const { memory, devices, sessions } = deps;

  server.registerTool(
    'session_brief',
    {
      title: 'Session brief',
      description:
        'Call this FIRST for every user request. One call returns what you need to answer: the current local date/time, ' +
        'who is speaking, the most relevant remembered facts (with source and confidence), the conversation in progress ' +
        "(also when it started on another device) and the device's live state. " +
        'Only state facts that appear here or in recall. If ask_who_is_speaking is true, ask before using anything personal; ' +
        'if speaker_candidate is present, confirm it ("Is this Aisyah?") first.',
      inputSchema: {
        ...speakerArgs,
        device: deviceArg,
        hint: z.string().optional().describe("The user's request, used to pick relevant facts."),
      },
      annotations: { readOnlyHint: true },
    },
    ({ speaker, speaker_confidence, device, hint }) =>
      timed('session_brief', async () => {
        const [household, identity] = await Promise.all([
          memory.household(ctx.householdId),
          memory.identify(ctx.householdId, speaker, speaker_confidence),
        ]);
        if (!household) throw new Error('Household not found');
        const who = identity.speaker;
        const [facts, session, deviceStates] = await Promise.all([
          memory.recall(ctx.householdId, who, hint ?? '', 8),
          device ? sessions.active(ctx.householdId, device, who?.person_id ?? null) : null,
          device ? devices.state(ctx.householdId, device) : [],
        ]);
        return json({
          temporal: temporalStamp(household.timezone),
          household: household.name,
          speaker: who && { id: who.person_id, name: who.display_name, role: who.role },
          ask_who_is_speaking: !who,
          ...(identity.candidate ? { speaker_candidate: identity.candidate } : {}),
          facts,
          ...(session
            ? {
                active_session: {
                  session_id: session.session_id,
                  started_on: session.device_id,
                  handoff: session.device_id !== device,
                  recent_turns: session.turns.slice(-HANDOFF_TURNS),
                },
              }
            : {}),
          ...(deviceStates[0] ? { device_state: deviceStates[0].state } : {}),
          not_yet_available: NOT_YET_AVAILABLE,
        });
      }),
  );

  server.registerTool(
    'recall',
    {
      title: 'Recall',
      description:
        "Search remembered facts visible to the speaker (their own plus the household's), ranked, with source and confidence. " +
        "Facts marked why='pending_extraction' are the speaker's own recent words, not yet processed. " +
        'If the speaker is unknown or unconfirmed, only household facts are returned.',
      inputSchema: {
        ...speakerArgs,
        query: z.string().describe('What to look for, in plain words.'),
        limit: z.number().int().min(1).max(20).default(5),
      },
      annotations: { readOnlyHint: true },
    },
    ({ speaker, speaker_confidence, query, limit }) =>
      timed('recall', async () => {
        const [household, identity] = await Promise.all([
          memory.household(ctx.householdId),
          memory.identify(ctx.householdId, speaker, speaker_confidence),
        ]);
        if (!household) throw new Error('Household not found');
        const facts = await memory.recall(ctx.householdId, identity.speaker, query, limit);
        return json({ temporal: temporalStamp(household.timezone), speaker_resolved: !!identity.speaker, facts });
      }),
  );

  server.registerTool(
    'remember',
    {
      title: 'Remember',
      description:
        'Store something the speaker asked you to remember, or a stable preference they stated. Acknowledges immediately; ' +
        "facts are extracted in the background. Use scope 'household' only for things that belong to everyone. " +
        'Card or account numbers, passwords, ID numbers and diagnoses are never stored: if the result has a message, say it plainly.',
      inputSchema: {
        ...speakerArgs,
        device: deviceArg,
        text: z.string().min(1).max(2000).describe("What to remember, in the speaker's words."),
        scope: z.enum(['person', 'household']).default('person'),
      },
    },
    ({ speaker, speaker_confidence, device, text, scope }) =>
      timed('remember', async () => {
        const identity = await memory.identify(ctx.householdId, speaker, speaker_confidence);
        return json(await memory.remember(ctx.householdId, identity.speaker, text, scope, device));
      }),
  );
}
