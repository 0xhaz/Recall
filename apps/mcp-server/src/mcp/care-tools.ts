import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as z from 'zod';
import type { HouseholdContext } from '../auth/household-auth.js';
import type { CareService } from '../care/care.service.js';
import type { ReminderService } from '../care/reminder.service.js';
import type { MemoryService } from '../memory/memory.service.js';
import type { CheckinService } from '../routines/checkin.service.js';
import { deviceArg, json, speakerArgs, type Timed } from './tool-kit.js';

export interface CareToolDeps {
  memory: MemoryService;
  checkins: CheckinService;
  care: CareService;
  reminders: ReminderService;
}

export function registerCareTools(server: McpServer, ctx: HouseholdContext, deps: CareToolDeps, timed: Timed): void {
  const { memory, checkins, care, reminders } = deps;

  const whoAndWhere = async (speaker?: string, confidence?: number) => {
    const [household, identity] = await Promise.all([
      memory.household(ctx.householdId),
      memory.identify(ctx.householdId, speaker, confidence),
    ]);
    if (!household) throw new Error('Household not found');
    return { household, identity };
  };

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
        const { household, identity } = await whoAndWhere(speaker, speaker_confidence);
        return json(await checkins.checkin(household, identity.speaker, kind, device));
      }),
  );

  server.registerTool(
    'set_care_policy',
    {
      title: 'Set care policy',
      description:
        'A caregiver\'s instruction for how to handle a topic with the person they care for: "correct" (say plainly ' +
        'what is true, for safety: the stove, doors, medication) or "redirect" (reassure and turn to something ' +
        'familiar, e.g. a late spouse or "I want to go home"). Only a caregiver with the care-plan grant, or the ' +
        "household owner. Use the caregiver's own words for guidance.",
      inputSchema: {
        ...speakerArgs,
        person: z.string().min(1).max(80).describe('The person being cared for.'),
        topic: z.string().min(2).max(80),
        keywords: z
          .array(z.string().min(2).max(40))
          .max(12)
          .optional()
          .describe("Words or phrases that bring the topic up; defaults to the topic's own words."),
        policy: z.enum(['correct', 'redirect']),
        guidance: z.string().max(300).optional(),
        remove: z.boolean().default(false),
      },
    },
    ({ speaker, speaker_confidence, ...input }) =>
      timed('set_care_policy', async () => {
        const { household, identity } = await whoAndWhere(speaker, speaker_confidence);
        return json(await care.setPolicy(household, identity.speaker, input));
      }),
  );

  server.registerTool(
    'set_reminder',
    {
      title: 'Set a reminder',
      description:
        "A caregiver's schedule for the person they care for: medication or a meal, at times of day. Recall asks them " +
        'on their own device when it is due, and tells the carers only if it goes unanswered. Only a caregiver with ' +
        'the care-plan grant, or the household owner. Enter what the caregiver says; never invent a schedule or a dose.',
      inputSchema: {
        ...speakerArgs,
        person: z.string().min(1).max(80).describe('The person being cared for.'),
        kind: z.enum(['medication', 'meal', 'other']).default('medication'),
        label: z.string().min(2).max(80).describe('What it is, in their words: "the blood pressure tablet".'),
        dose: z.string().max(60).optional().describe('As the caregiver says it: "one tablet".'),
        times: z
          .array(z.string().regex(/^\d{1,2}:\d{2}$/))
          .min(1)
          .max(8)
          .describe('Local times of day, e.g. ["08:00", "20:00"].'),
        days: z.enum(['daily', 'weekdays', 'weekends']).default('daily'),
        device: deviceArg,
        grace_minutes: z.number().int().min(0).max(240).optional(),
        escalate_after_minutes: z.number().int().min(5).max(480).optional(),
      },
    },
    ({ speaker, speaker_confidence, ...input }) =>
      timed('set_reminder', async () => {
        const { household, identity } = await whoAndWhere(speaker, speaker_confidence);
        return json(await reminders.set(household, identity.speaker, input));
      }),
  );

  server.registerTool(
    'confirm_reminder',
    {
      title: 'Confirm a reminder',
      description:
        'The person says they have taken their medication or had their meal ("taken", "I\'ve had it"). Call it only ' +
        'when they say so themselves: never on their behalf, and never because they went quiet. Their own words are ' +
        'kept with the record, and the carers are told it was confirmed.',
      inputSchema: {
        ...speakerArgs,
        said: z.string().max(200).optional().describe('What they said, in their words.'),
      },
    },
    ({ speaker, speaker_confidence, said }) =>
      timed('confirm_reminder', async () => {
        const { household, identity } = await whoAndWhere(speaker, speaker_confidence);
        return json(await reminders.confirmSpoken(household, identity.speaker, said));
      }),
  );
}
