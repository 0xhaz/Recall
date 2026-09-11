import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Logger } from '@nestjs/common';
import { temporalStamp } from '@recall/core';
import * as z from 'zod';
import type { HouseholdContext } from '../auth/household-auth.js';
import type { MemoryService } from '../memory/memory.service.js';

const logger = new Logger('mcp');

// Sections of session_brief that later weeks fill in. Listed explicitly so the model
// knows they are absent rather than inventing them.
const NOT_YET_AVAILABLE = ['rules', 'context_scores', 'quiet_hours', 'device_state'];

const speakerArgs = {
  speaker: z
    .string()
    .optional()
    .describe('Who is speaking: their name or person id as identified by the device. Omit if unknown — never guess.'),
  speaker_confidence: z
    .number()
    .min(0)
    .max(1)
    .optional()
    .describe(
      'How sure the device is about the speaker (e.g. a voice-match score). Defaults to 1 when named explicitly.',
    ),
};

function json(value: unknown): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(value) }] };
}

/** Log per-tool latency; published p50/p95 comes in week 3 (workplan WS15). */
async function timed(tool: string, fn: () => Promise<CallToolResult>): Promise<CallToolResult> {
  const started = performance.now();
  try {
    return await fn();
  } finally {
    logger.log(`tool=${tool} ms=${(performance.now() - started).toFixed(1)}`);
  }
}

/** One MCP server per request (stateless Streamable HTTP), bound to the caller's household. */
export function buildMcpServer(ctx: HouseholdContext, memory: MemoryService): McpServer {
  const server = new McpServer({ name: 'recall', version: '0.2.0' });

  server.registerTool(
    'session_brief',
    {
      title: 'Session brief',
      description:
        'Call this FIRST for every user request. One call returns what you need to answer: the current local date/time, ' +
        'who is speaking, and the most relevant remembered facts (with source and confidence). ' +
        'Only state facts that appear here or in recall. If ask_who_is_speaking is true, ask before using anything personal; ' +
        'if speaker_candidate is present, confirm it ("Is this Aisyah?") first.',
      inputSchema: {
        ...speakerArgs,
        hint: z.string().optional().describe("The user's request, used to pick relevant facts."),
      },
      annotations: { readOnlyHint: true },
    },
    ({ speaker, speaker_confidence, hint }) =>
      timed('session_brief', async () => {
        const [household, identity] = await Promise.all([
          memory.household(ctx.householdId),
          memory.identify(ctx.householdId, speaker, speaker_confidence),
        ]);
        if (!household) throw new Error('Household not found');
        const facts = await memory.recall(ctx.householdId, identity.speaker, hint ?? '', 8);
        const who = identity.speaker;
        return json({
          temporal: temporalStamp(household.timezone),
          household: household.name,
          speaker: who && { id: who.person_id, name: who.display_name, role: who.role },
          ask_who_is_speaking: !who,
          ...(identity.candidate ? { speaker_candidate: identity.candidate } : {}),
          facts,
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
        text: z.string().min(1).max(2000).describe("What to remember, in the speaker's words."),
        scope: z.enum(['person', 'household']).default('person'),
      },
    },
    ({ speaker, speaker_confidence, text, scope }) =>
      timed('remember', async () => {
        const identity = await memory.identify(ctx.householdId, speaker, speaker_confidence);
        return json(await memory.remember(ctx.householdId, identity.speaker, text, scope));
      }),
  );

  return server;
}
