import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { temporalStamp } from '@recall/core';
import * as z from 'zod';
import type { HouseholdContext } from '../auth/household-auth.js';
import type { MemoryService } from '../memory/memory.service.js';
import { ParsedRule } from '../rules/parse.js';
import type { RulesService } from '../rules/rules.service.js';
import { deviceArg, json, speakerArgs, type Timed } from './tool-kit.js';

export interface RuleToolDeps {
  memory: MemoryService;
  rules: RulesService;
}

export function registerRuleTools(server: McpServer, ctx: HouseholdContext, deps: RuleToolDeps, timed: Timed): void {
  const { memory, rules } = deps;

  const whoAndWhere = async (speaker?: string, confidence?: number) => {
    const [household, identity] = await Promise.all([
      memory.household(ctx.householdId),
      memory.identify(ctx.householdId, speaker, confidence),
    ]);
    if (!household) throw new Error('Household not found');
    return { household, identity };
  };

  server.registerTool(
    'set_rule',
    {
      title: 'Set rule',
      description:
        'Save a rule the person states ("no music after 10pm on school nights", "always ask before ordering", "never ' +
        'suggest peanut recipes for Sofia"). Rules are law: they override anything learned. Pass applies_to when you know ' +
        'who it is for, and ask if you are unsure. If the result lists conflicts, tell the person: nothing is resolved automatically.',
      inputSchema: {
        ...speakerArgs,
        text: z.string().min(3).max(500).describe("The rule in the person's own words."),
        applies_to: z.string().max(80).optional().describe('"me", "household", a person\'s name, or a device id.'),
        severity: z
          .enum(['hard', 'soft', 'safety'])
          .optional()
          .describe('safety: only for a caregiver protecting the person they care for (stove, door, medication).'),
        device: deviceArg,
        structured: ParsedRule.optional().describe('For the console: the rule already in structured form.'),
      },
    },
    ({ speaker, speaker_confidence, text, applies_to, severity, device, structured }) =>
      timed('set_rule', async () => {
        const { household, identity } = await whoAndWhere(speaker, speaker_confidence);
        return json(
          await rules.set(household, identity.speaker, text, {
            appliesTo: applies_to,
            severity,
            structured,
            deviceId: device,
          }),
        );
      }),
  );

  server.registerTool(
    'list_rules',
    {
      title: 'List rules',
      description:
        'The rules in force that the speaker can see, word for word, with who set them and when. Read them back verbatim.',
      inputSchema: { ...speakerArgs },
      annotations: { readOnlyHint: true },
    },
    ({ speaker, speaker_confidence }) =>
      timed('list_rules', async () => {
        const { household, identity } = await whoAndWhere(speaker, speaker_confidence);
        return json({
          temporal: temporalStamp(household.timezone),
          rules: await rules.list(ctx.householdId, identity.speaker),
        });
      }),
  );

  server.registerTool(
    'remove_rule',
    {
      title: 'Remove rule',
      description:
        'Remove a rule by id (from list_rules). Only its author can, or a caregiver for the person they care for.',
      inputSchema: { ...speakerArgs, rule_id: z.string().uuid() },
      annotations: { destructiveHint: true },
    },
    ({ speaker, speaker_confidence, rule_id }) =>
      timed('remove_rule', async () => {
        const { identity } = await whoAndWhere(speaker, speaker_confidence);
        return json(await rules.remove(ctx.householdId, identity.speaker, rule_id));
      }),
  );
}
