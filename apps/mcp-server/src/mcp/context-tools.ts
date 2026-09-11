import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { CONTEXTS, temporalStamp } from '@recall/core';
import * as z from 'zod';
import type { HouseholdContext } from '../auth/household-auth.js';
import type { ContextService } from '../context/context.service.js';
import type { MusicService } from '../context/music.service.js';
import type { MemoryService } from '../memory/memory.service.js';
import type { RoutineMiner } from '../routines/miner.service.js';
import { deviceArg, json, speakerArgs, type Timed } from './tool-kit.js';

export interface ContextToolDeps {
  memory: MemoryService;
  contexts: ContextService;
  music: MusicService;
  routines: RoutineMiner;
}

const contextArg = z.enum(CONTEXTS);

export function registerContextTools(
  server: McpServer,
  ctx: HouseholdContext,
  deps: ContextToolDeps,
  timed: Timed,
): void {
  const { memory, contexts, music, routines } = deps;

  const whoAndWhere = async (speaker?: string, confidence?: number) => {
    const [household, identity] = await Promise.all([
      memory.household(ctx.householdId),
      memory.identify(ctx.householdId, speaker, confidence),
    ]);
    if (!household) throw new Error('Household not found');
    return { household, identity };
  };

  server.registerTool(
    'get_context',
    {
      title: 'Get context',
      description:
        "What's going on: context scores (workout, wind-down, party, festive, focus) with what's driving them, whether " +
        "it's quiet hours, and the routines that are due soon or need attention. During quiet hours, say nothing unprompted.",
      inputSchema: { ...speakerArgs },
      annotations: { readOnlyHint: true },
    },
    ({ speaker, speaker_confidence }) =>
      timed('get_context', async () => {
        const { household, identity } = await whoAndWhere(speaker, speaker_confidence);
        const personId = identity.speaker?.person_id ?? null;
        const [reading, due] = await Promise.all([
          contexts.read(ctx.householdId, personId),
          routines.list(ctx.householdId, personId, household.timezone),
        ]);
        return json({ temporal: temporalStamp(household.timezone), ...reading, routines: due });
      }),
  );

  server.registerTool(
    'set_context',
    {
      title: 'Set context',
      description:
        'When the person says so ("workout mode", "stop workout mode", "it\'s party time", "quiet time"): switch a ' +
        'context on or off now. It wins over the signals for a while, and teaches the automatic trigger.',
      inputSchema: {
        ...speakerArgs,
        context: contextArg,
        on: z.boolean().default(true),
        minutes: z.number().int().min(5).max(240).optional().describe('How long it should hold; defaults per context.'),
      },
    },
    ({ speaker, speaker_confidence, context, on, minutes }) =>
      timed('set_context', async () => {
        const { household, identity } = await whoAndWhere(speaker, speaker_confidence);
        if (!identity.speaker) {
          return json({ refused: 'unknown_speaker', message: 'Ask who is speaking before changing the mode.' });
        }
        if (identity.speaker.role === 'guest') {
          return json({ refused: 'not_allowed', message: "Guests can't change the household's mode." });
        }
        return json({ context: await contexts.setManual(household, identity.speaker, context, on, minutes) });
      }),
  );

  server.registerTool(
    'suggest_music',
    {
      title: 'Suggest music',
      description:
        'Music for the live context (or the one given), ranked by fit and what this person plays or skips, from a mock ' +
        'catalogue. Returns nothing when a stated rule forbids music now: then say so, quoting the rule. Offer before ' +
        'playing unless the person asked for music.',
      inputSchema: { ...speakerArgs, context: contextArg.optional(), device: deviceArg },
      annotations: { readOnlyHint: true },
    },
    ({ speaker, speaker_confidence, context, device }) =>
      timed('suggest_music', async () => {
        const { household, identity } = await whoAndWhere(speaker, speaker_confidence);
        return json(await music.suggest(household, identity.speaker, { context, device }));
      }),
  );
}
