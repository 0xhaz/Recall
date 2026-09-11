import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as z from 'zod';
import type { HouseholdContext } from '../auth/household-auth.js';
import type { MemoryService } from '../memory/memory.service.js';
import type { CheckinService } from '../routines/checkin.service.js';
import { deviceArg, json, speakerArgs, type Timed } from './tool-kit.js';

export interface CareToolDeps {
  memory: MemoryService;
  checkins: CheckinService;
}

export function registerCareTools(server: McpServer, ctx: HouseholdContext, deps: CareToolDeps, timed: Timed): void {
  const { memory, checkins } = deps;

  server.registerTool(
    'checkin',
    {
      title: 'Check in',
      description:
        'The person checks in ("good morning", "good night"): it is logged and the family is told. Call it only when the ' +
        'person says it themselves, never on their behalf. Confirm briefly, e.g. "Good morning — I\'ve let the family know."',
      inputSchema: {
        ...speakerArgs,
        kind: z
          .string()
          .regex(/^[a-z_]{1,20}$/)
          .default('morning')
          .describe('"morning", "night", or another short name for the check-in.'),
        device: deviceArg,
      },
    },
    ({ speaker, speaker_confidence, kind, device }) =>
      timed('checkin', async () => {
        const [household, identity] = await Promise.all([
          memory.household(ctx.householdId),
          memory.identify(ctx.householdId, speaker, speaker_confidence),
        ]);
        if (!household) throw new Error('Household not found');
        return json(await checkins.checkin(household, identity.speaker, kind, device));
      }),
  );
}
