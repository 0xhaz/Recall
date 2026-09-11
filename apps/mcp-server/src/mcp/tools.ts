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

const speakerArg = z
  .string()
  .optional()
  .describe('Who is speaking: their name or person id as identified by the device. Omit if unknown — never guess.');

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
  const server = new McpServer({ name: 'recall', version: '0.1.0' });

  server.registerTool(
    'session_brief',
    {
      title: 'Session brief',
      description:
        'Call this FIRST for every user request. One call returns what you need to answer: the current local date/time, ' +
        'who is speaking, and the most relevant remembered facts (with source and confidence). ' +
        'Only state facts that appear here or in recall; if ask_who_is_speaking is true, ask before using anything personal.',
      inputSchema: {
        speaker: speakerArg,
        hint: z.string().optional().describe("The user's request, used to pick relevant facts."),
      },
      annotations: { readOnlyHint: true },
    },
    ({ speaker, hint }) =>
      timed('session_brief', async () => {
        const [household, resolved] = await Promise.all([
          memory.household(ctx.householdId),
          memory.resolveSpeaker(ctx.householdId, speaker),
        ]);
        if (!household) throw new Error('Household not found');
        const facts = await memory.recall(ctx.householdId, resolved, hint ?? '', 8);
        return json({
          temporal: temporalStamp(household.timezone),
          household: household.name,
          speaker: resolved && { id: resolved.person_id, name: resolved.display_name, role: resolved.role },
          ask_who_is_speaking: !resolved,
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
        'If the speaker is unknown, only household facts are returned.',
      inputSchema: {
        speaker: speakerArg,
        query: z.string().describe('What to look for, in plain words.'),
        limit: z.number().int().min(1).max(20).default(5),
      },
      annotations: { readOnlyHint: true },
    },
    ({ speaker, query, limit }) =>
      timed('recall', async () => {
        const [household, resolved] = await Promise.all([
          memory.household(ctx.householdId),
          memory.resolveSpeaker(ctx.householdId, speaker),
        ]);
        if (!household) throw new Error('Household not found');
        const facts = await memory.recall(ctx.householdId, resolved, query, limit);
        return json({ temporal: temporalStamp(household.timezone), speaker_resolved: !!resolved, facts });
      }),
  );

  server.registerTool(
    'remember',
    {
      title: 'Remember',
      description:
        'Store something the speaker asked you to remember, or a stable preference they stated. Acknowledges immediately. ' +
        "Use scope 'household' only for things that belong to everyone (shared lists, family restaurants).",
      inputSchema: {
        speaker: speakerArg,
        text: z.string().min(1).max(2000).describe("What to remember, in the speaker's words."),
        scope: z.enum(['person', 'household']).default('person'),
      },
    },
    ({ speaker, text, scope }) =>
      timed('remember', async () => {
        const resolved = await memory.resolveSpeaker(ctx.householdId, speaker);
        return json(await memory.remember(ctx.householdId, resolved, text, scope));
      }),
  );

  return server;
}
