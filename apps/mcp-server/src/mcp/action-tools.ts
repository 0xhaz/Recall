import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ACTION_INTENTS, temporalStamp } from '@recall/core';
import * as z from 'zod';
import type { ActionService } from '../actions/action.service.js';
import type { HouseholdContext } from '../auth/household-auth.js';
import type { MemoryService } from '../memory/memory.service.js';
import { deviceArg, json, speakerArgs, type Timed } from './tool-kit.js';

export interface ActionToolDeps {
  memory: MemoryService;
  actions: ActionService;
}

const COMMAND_KIND = /^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$/;
const SERVER_KIND = /^(fact|rule|utterance|action|memory|context|notice)\./;

const actionArg = z.object({
  intent: z.enum(ACTION_INTENTS),
  summary: z
    .string()
    .min(3)
    .max(300)
    .describe('What would be done, in plain words: "Order nasi lemak from Napoli Pizza to 12 Bergen Street".'),
  topics: z.array(z.string().max(40)).max(10).optional(),
  device: deviceArg,
  details: z
    .object({
      venue: z.string().max(120).optional(),
      address: z.string().max(200).optional(),
      amount: z.number().nonnegative().optional(),
      currency: z.string().max(8).optional(),
      when: z.string().max(40).optional().describe('When it would happen, ISO 8601; omit for now.'),
      items: z.array(z.string().max(80)).max(20).optional(),
    })
    .optional(),
  command: z
    .object({
      kind: z
        .string()
        .regex(COMMAND_KIND)
        .refine((kind) => !SERVER_KIND.test(kind), 'Not a device command'),
      payload: z.record(z.string(), z.unknown()).default({}),
    })
    .optional()
    .describe('For device actions, the command to send, e.g. {"kind": "media.play", "payload": {"title": "…"}}.'),
});

export function registerActionTools(
  server: McpServer,
  ctx: HouseholdContext,
  deps: ActionToolDeps,
  timed: Timed,
): void {
  const { memory, actions } = deps;

  const whoAndWhere = async (speaker?: string, confidence?: number) => {
    const [household, identity] = await Promise.all([
      memory.household(ctx.householdId),
      memory.identify(ctx.householdId, speaker, confidence),
    ]);
    if (!household) throw new Error('Household not found');
    return { household, identity };
  };

  server.registerTool(
    'action_preflight',
    {
      title: 'Action pre-flight',
      description:
        "Call BEFORE doing anything on the person's behalf: an order, purchase, booking, ride, call, reminder, " +
        "notification or device change. Checks it against stated rules, quiet hours, what's on record (the address, " +
        'venues used before, recent orders) and routines. decision "block": don\'t do it, and say why (quote ' +
        'blocked_by.text word for word). "confirm": ask about each item. "allow": go ahead. Either way, pass the ' +
        "person's answer and the action_id to decide_action.",
      inputSchema: { ...speakerArgs, action: actionArg },
    },
    ({ speaker, speaker_confidence, action }) =>
      timed('action_preflight', async () => {
        const { household, identity } = await whoAndWhere(speaker, speaker_confidence);
        const result = await actions.preflight(household, identity.speaker, action);
        return json({ temporal: temporalStamp(household.timezone), ...result });
      }),
  );

  server.registerTool(
    'propose_action',
    {
      title: 'Propose action',
      description:
        "What to offer right now, if anything: a usual routine that's due, the next step of a routine chain, or music " +
        'for the live context, each with where it comes from. Say the `say` line and wait; pass the answer to ' +
        'decide_action. Nothing is offered during quiet hours. Tier "act" means it has already started as usual: ' +
        'say so and mention undo.',
      inputSchema: { ...speakerArgs, device: deviceArg },
    },
    ({ speaker, speaker_confidence, device }) =>
      timed('propose_action', async () => {
        const { household, identity } = await whoAndWhere(speaker, speaker_confidence);
        const result = await actions.propose(household, identity.speaker, device ?? null);
        return json({ temporal: temporalStamp(household.timezone), ...result });
      }),
  );

  server.registerTool(
    'decide_action',
    {
      title: 'Decide action',
      description:
        'The person\'s answer to an offer or a pre-flighted action: "confirm" carries it out and returns how long it ' +
        'can be undone; "dismiss" drops it. Offers that keep being dismissed stop being made.',
      inputSchema: {
        ...speakerArgs,
        action_id: z.string().uuid(),
        decision: z.enum(['confirm', 'dismiss']),
      },
    },
    ({ speaker, speaker_confidence, action_id, decision }) =>
      timed('decide_action', async () => {
        const { household, identity } = await whoAndWhere(speaker, speaker_confidence);
        return json(await actions.decide(household, identity.speaker, action_id, decision));
      }),
  );

  server.registerTool(
    'undo',
    {
      title: 'Undo',
      description:
        "Reverse something done through Recall while its undo window is open; without action_id, the speaker's " +
        'latest. For device actions, re-read device_state before saying it has stopped.',
      inputSchema: { ...speakerArgs, action_id: z.string().uuid().optional() },
    },
    ({ speaker, speaker_confidence, action_id }) =>
      timed('undo', async () => {
        const { household, identity } = await whoAndWhere(speaker, speaker_confidence);
        return json(await actions.undo(household, identity.speaker, action_id));
      }),
  );
}
