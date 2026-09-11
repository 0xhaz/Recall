// Read-only smoke test against a running server: the same calls Claude makes as the Alexa+ stand-in.
// Usage: pnpm dev (in one terminal), then pnpm smoke.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { loadDotEnv } from '../src/env.js';

loadDotEnv();
const url = new URL(process.env.RECALL_URL ?? `http://127.0.0.1:${process.env.PORT ?? 3100}/mcp`);
const token = process.env.RECALL_DEV_TOKEN;

const client = new Client({ name: 'recall-smoke', version: '0.1.0' });
await client.connect(
  new StreamableHTTPClientTransport(url, {
    requestInit: { headers: token ? { Authorization: `Bearer ${token}` } : {} },
  }),
);

const { tools } = await client.listTools();
console.log(`tools: ${tools.map((t) => t.name).join(', ')}`);

async function call(name: string, args: Record<string, unknown>): Promise<void> {
  const started = performance.now();
  const result = await client.callTool({ name, arguments: args });
  const ms = (performance.now() - started).toFixed(0);
  const text = (result.content as Array<{ type: string; text?: string }>)[0]?.text ?? '';
  console.log(`\n▶ ${name} ${JSON.stringify(args)} — ${ms} ms round trip`);
  console.log(JSON.stringify(JSON.parse(text), null, 2));
}

const hint = 'what should we cook tonight?';
await call('session_brief', { speaker: 'Aisyah', hint });
await call('session_brief', { speaker: 'Daniel', hint });
await call('session_brief', { hint });
await call('recall', { speaker: 'Sofia', query: 'allergies peanuts' });

await client.close();
