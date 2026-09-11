import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { DEFAULT_STYLE, RESPONSE_RULES, temporalStamp } from '@recall/core';
import * as z from 'zod';
import type { HouseholdContext } from '../auth/household-auth.js';
import type { CareService } from '../care/care.service.js';
import type { ContextService } from '../context/context.service.js';
import type { DeviceService } from '../devices/device.service.js';
import type { ExplainService } from '../memory/explain.service.js';
import type { ForgetService } from '../memory/forget.service.js';
import type { MemoryService } from '../memory/memory.service.js';
import type { RulesService } from '../rules/rules.service.js';
import type { SessionService } from '../sessions/session.service.js';
import { deviceArg, json, speakerArgs, type Timed } from './tool-kit.js';

const HANDOFF_TURNS = 6;

export interface MemoryToolDeps {
  memory: MemoryService;
  devices: DeviceService;
  sessions: SessionService;
  forget: ForgetService;
  explain: ExplainService;
  rules: RulesService;
  contexts: ContextService;
  care: CareService;
}

export function registerMemoryTools(
  server: McpServer,
  ctx: HouseholdContext,
  deps: MemoryToolDeps,
  timed: Timed,
): void {
  const { memory, devices, sessions, forget, explain, rules, contexts, care } = deps;

  const whoAndWhere = async (speaker?: string, confidence?: number) => {
    const [household, identity] = await Promise.all([
      memory.household(ctx.householdId),
      memory.identify(ctx.householdId, speaker, confidence),
    ]);
    if (!household) throw new Error('Household not found');
    return { household, identity };
  };

  server.registerTool(
    'session_brief',
    {
      title: 'Session brief',
      description:
        'Call this FIRST for every user request. One call returns what you need to answer: the current local date/time, ' +
        'who is speaking and how they like to be spoken to, the rules that apply (which override anything learned), the ' +
        'most relevant remembered facts (with source and confidence), the conversation in progress (also when it started ' +
        "on another device), the device's live state, and what's going on (active contexts, quiet hours). " +
        'Only state facts that appear here or in recall. If ask_who_is_speaking is true, ask before using anything personal; ' +
        'if speaker_candidate is present, confirm it ("Is this Aisyah?") first. During quiet hours, answer briefly and ' +
        'offer nothing unprompted. If `repeat` is present, follow its guidance. For a person being cared for (`care`), ' +
        'follow care.rules and any policy listed; only caregiver-entered facts are returned for them.',
      inputSchema: {
        ...speakerArgs,
        device: deviceArg,
        hint: z.string().optional().describe("The user's request, used to pick relevant facts."),
      },
      annotations: { readOnlyHint: true },
    },
    ({ speaker, speaker_confidence, device, hint }) =>
      timed('session_brief', async () => {
        const { household, identity } = await whoAndWhere(speaker, speaker_confidence);
        const who = identity.speaker;
        const [facts, style, applicableRules, session, deviceStates, reading] = await Promise.all([
          memory.recall(ctx.householdId, who, hint ?? '', 8),
          who ? memory.style(who.person_id) : DEFAULT_STYLE,
          rules.applicable(ctx.householdId, who?.person_id ?? null, device),
          device ? sessions.active(ctx.householdId, device, who?.person_id ?? null) : null,
          device ? devices.state(ctx.householdId, device) : [],
          contexts.read(ctx.householdId, who?.person_id ?? null),
        ]);
        const extras = await care.brief(household, who, hint, session);
        return json({
          temporal: temporalStamp(household.timezone),
          household: household.name,
          speaker: who && { id: who.person_id, name: who.display_name, role: who.role },
          ask_who_is_speaking: !who,
          ...(identity.candidate ? { speaker_candidate: identity.candidate } : {}),
          response_style: { ...style, rules: RESPONSE_RULES },
          rules: applicableRules.map(({ id, text, summary, effect, severity }) => ({
            id,
            text,
            summary,
            effect,
            severity,
          })),
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
          // Only what's on: the full scores are in get_context.
          contexts: reading.contexts
            .filter((c) => c.active)
            .map(({ context, for: whose, since, reasons }) => ({ context, for: whose, since, reasons })),
          quiet_hours: reading.quiet_hours,
          ...extras,
        });
      }),
  );

  server.registerTool(
    'recall',
    {
      title: 'Recall',
      description:
        "Search remembered facts visible to the speaker (their own plus the household's), ranked by meaning and shared words, " +
        "with source and confidence. Facts marked why='pending_extraction' are the speaker's own recent words, not yet " +
        'processed. If the speaker is unknown or unconfirmed, only household facts are returned.',
      inputSchema: {
        ...speakerArgs,
        query: z.string().describe('What to look for, in plain words.'),
        limit: z.number().int().min(1).max(20).default(5),
      },
      annotations: { readOnlyHint: true },
    },
    ({ speaker, speaker_confidence, query, limit }) =>
      timed('recall', async () => {
        const { household, identity } = await whoAndWhere(speaker, speaker_confidence);
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
        said_hlc: z
          .string()
          .optional()
          .describe("For devices uploading late: the device's HLC stamp for when it was said."),
      },
    },
    ({ speaker, speaker_confidence, device, text, scope, said_hlc }) =>
      timed('remember', async () => {
        const identity = await memory.identify(ctx.householdId, speaker, speaker_confidence);
        return json(await memory.remember(ctx.householdId, identity.speaker, text, scope, device, said_hlc));
      }),
  );

  server.registerTool(
    'forget',
    {
      title: 'Forget',
      description:
        'Forget something for good, on every device. Pass the topic in the speaker\'s words ("that I\'m on a diet") or ' +
        'fact_ids from an earlier result. If the result has needs_confirmation, read the options to the person, then call ' +
        'again with the chosen fact_ids. Tell them plainly what was forgotten.',
      inputSchema: {
        ...speakerArgs,
        topic: z.string().max(500).optional(),
        fact_ids: z.array(z.string().uuid()).max(20).optional(),
      },
      annotations: { destructiveHint: true },
    },
    ({ speaker, speaker_confidence, topic, fact_ids }) =>
      timed('forget', async () => {
        const { identity } = await whoAndWhere(speaker, speaker_confidence);
        return json(await forget.forget(ctx.householdId, identity.speaker, { topic, factIds: fact_ids }));
      }),
  );

  server.registerTool(
    'explain_memory',
    {
      title: 'Explain memory',
      description:
        'What Recall keeps about the speaker and the household, and where each item came from. Use it for "what do you ' +
        'know about me?" or "do you know anything about my uncle?" (pass about). Read out `spoken` or summarise the items; ' +
        "never add anything that isn't in the result.",
      inputSchema: {
        ...speakerArgs,
        about: z.string().max(200).optional().describe("A topic or person to look for, in the speaker's words."),
      },
      annotations: { readOnlyHint: true },
    },
    ({ speaker, speaker_confidence, about }) =>
      timed('explain_memory', async () => {
        const { household, identity } = await whoAndWhere(speaker, speaker_confidence);
        return json({
          temporal: temporalStamp(household.timezone),
          ask_who_is_speaking: !identity.speaker,
          ...(await explain.explain(household, identity.speaker, about)),
        });
      }),
  );

  server.registerTool(
    'verify_claim',
    {
      title: 'Verify claim',
      description:
        'Before stating something about a person or the household as fact, check it here. Compare the claim with the ' +
        "evidence yourself: if nothing on record says the same thing, don't assert it — say you don't know, or ask.",
      inputSchema: {
        ...speakerArgs,
        claim: z.string().min(1).max(500),
      },
      annotations: { readOnlyHint: true },
    },
    ({ speaker, speaker_confidence, claim }) =>
      timed('verify_claim', async () => {
        const { household, identity } = await whoAndWhere(speaker, speaker_confidence);
        return json({
          temporal: temporalStamp(household.timezone),
          ...(await explain.verify(household, identity.speaker, claim)),
        });
      }),
  );

  server.registerTool(
    'set_communication_style',
    {
      title: 'Set communication style',
      description:
        'Change how you talk to this person when they ask ("keep it short", "no jokes", "you can chat more"). ' +
        'It applies on every device.',
      inputSchema: {
        ...speakerArgs,
        verbosity: z.enum(['brief', 'normal', 'detailed']).optional(),
        commentary: z.boolean().optional().describe('Tips and side remarks.'),
        humour: z.boolean().optional(),
        emotional_language: z.boolean().optional().describe('Reflecting feelings back ("that sounds stressful").'),
      },
    },
    ({ speaker, speaker_confidence, verbosity, commentary, humour, emotional_language }) =>
      timed('set_communication_style', async () => {
        const { identity } = await whoAndWhere(speaker, speaker_confidence);
        if (!identity.speaker) {
          return json({
            refused: 'unknown_speaker',
            message: 'Ask who is speaking before changing how you talk to them.',
          });
        }
        const style = await memory.setStyle(identity.speaker.person_id, {
          verbosity,
          commentary,
          humour,
          emotional_language,
        });
        return json({ style });
      }),
  );
}
