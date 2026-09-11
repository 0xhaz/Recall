import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import * as z from 'zod';

export const speakerArgs = {
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

export const DEVICE_ID = /^[A-Za-z0-9_.:-]{1,64}$/;

export const deviceArg = z
  .string()
  .regex(DEVICE_ID)
  .optional()
  .describe('The device this request comes from, e.g. "kitchen-echo".');

export function json(value: unknown): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(value) }] };
}

/** Runs a tool handler and records its server-side latency. */
export type Timed = (tool: string, fn: () => Promise<CallToolResult>) => Promise<CallToolResult>;
