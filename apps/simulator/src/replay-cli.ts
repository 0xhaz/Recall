// Usage: pnpm replay <name> [--speed 4]   (with the server running: pnpm dev)
import { config } from './config.js';
import { RecallClient } from './recall.js';
import { listReplays, loadReplay, runReplay } from './replay.js';

const [name, ...rest] = process.argv.slice(2);
if (!name) {
  console.log('Usage: pnpm replay <name> [--speed N]\n');
  for (const r of await listReplays()) console.log(`  ${r.name.padEnd(12)} ${r.mode.padEnd(8)} ${r.description}`);
  process.exit(0);
}
const speedAt = rest.indexOf('--speed');
const speed = speedAt >= 0 ? Number(rest[speedAt + 1]) : 1;

const replay = await loadReplay(name);
console.log(`▶ ${replay.name}: ${replay.description}`);
const { sent } = await runReplay(replay, new RecallClient(config.recallUrl, config.token), {
  timezone: config.timezone,
  speed,
  onEvent: (e) => {
    if (replay.mode === 'live') console.log(`  ${e.kind}${e.payload ? ` ${JSON.stringify(e.payload)}` : ''}`);
  },
});
console.log(`✓ ${sent} events accepted`);
// The MCP client keeps its connection open.
process.exit(0);
