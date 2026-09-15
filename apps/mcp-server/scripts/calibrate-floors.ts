// Where SIMILARITY_FLOOR comes from. Run it against any embedding model before trusting its floor:
// the numbers are a property of the model, and two models do not share a scale.
//
//   EMBEDDING_PROVIDER=bedrock pnpm --filter @recall/mcp-server calibrate
//   EMBEDDING_PROVIDER=ollama  pnpm --filter @recall/mcp-server calibrate
import { createEmbedder } from '@recall/llm';
import { loadDotEnv } from '../src/env.js';
import { floorFor } from '../src/memory/memory.service.js';

loadDotEnv();
const embedder = createEmbedder();
console.log(`calibrating ${embedder.model} @ ${embedder.dimensions} dimensions`);

// A question and the fact that should answer it.
const QUERY_RELATED: readonly Pair[] = [
  ['What should we cook tonight?', 'Emma is vegetarian'],
  ['What should I eat for dinner?', 'Daniel likes very spicy food'],
  ['Is there anything I should not eat?', 'Sofia is allergic to peanuts'],
  ['Where do we usually order from?', "The family's usual weeknight takeaway is Napoli Pizza"],
  ['What time is dinner?', 'Family dinner is usually around 19:30 on weekdays'],
  ['Where should the food be delivered?', "The family's home delivery address is 412 Bergen Street, Brooklyn"],
  ['How does she take her tea?', 'Ruth takes her tea with condensed milk'],
  ['When does Nina work?', 'Nina works night shifts on Tuesdays'],
  ['Can I have a coffee?', 'Daniel is off coffee until Wednesday'],
  ['When do I go running?', 'Emma goes running on Saturday mornings'],
];

const QUERY_UNRELATED: readonly Pair[] = [
  ['What time is dinner?', 'Emma goes running on Saturday mornings'],
  ['Where do we usually order from?', 'Nina works night shifts on Tuesdays'],
  ['Can I have a coffee?', "The family's home delivery address is 412 Bergen Street, Brooklyn"],
  ['When do I go running?', 'Ruth takes her tea with condensed milk'],
  ['How does she take her tea?', 'Sofia is allergic to peanuts'],
  ['Is there anything I should not eat?', 'Family dinner is usually around 19:30 on weekdays'],
  ['When does Nina work?', 'Daniel likes very spicy food'],
  ['What should we cook tonight?', 'Nina works night shifts on Tuesdays'],
];

// Statement mode: a restatement of a fact, versus a different fact entirely.
const STATEMENT_RELATED: readonly Pair[] = [
  ['I do not eat meat', 'Emma is vegetarian'],
  ['I love really hot food', 'Daniel likes very spicy food'],
  ['She cannot have peanuts', 'Sofia is allergic to peanuts'],
  ['We usually get takeaway from Napoli Pizza', "The family's usual weeknight takeaway is Napoli Pizza"],
  ['I am not drinking coffee this week', 'Daniel is off coffee until Wednesday'],
  ['Dinner is normally half seven on weeknights', 'Family dinner is usually around 19:30 on weekdays'],
];
const STATEMENT_UNRELATED: readonly Pair[] = [
  ['I do not eat meat', 'Nina works night shifts on Tuesdays'],
  ['I love really hot food', "The family's home delivery address is 412 Bergen Street, Brooklyn"],
  ['She cannot have peanuts', 'Emma goes running on Saturday mornings'],
  ['I am not drinking coffee this week', 'Ruth takes her tea with condensed milk'],
  ['Dinner is normally half seven on weeknights', 'Sofia is allergic to peanuts'],
];

type Pair = readonly [string, string];
interface Scored {
  pair: Pair;
  sim: number;
}

const cos = (a: number[], b: number[]): number => a.reduce((sum, x, i) => sum + x * (b[i] ?? 0), 0);

async function score(pairs: readonly Pair[]): Promise<Scored[]> {
  const left = await embedder.embed(pairs.map((p) => p[0]));
  const right = await embedder.embed(pairs.map((p) => p[1]));
  return pairs.map((p, i) => ({ pair: p, sim: cos(left[i] ?? [], right[i] ?? []) }));
}

function dump(name: string, rows: Scored[]): void {
  console.log(`  -- ${name}`);
  for (const r of [...rows].sort((a, b) => b.sim - a.sim)) {
    console.log(`     ${r.sim.toFixed(4)}  "${r.pair[0].slice(0, 42)}" ~ "${r.pair[1].slice(0, 44)}"`);
  }
}

function report(name: string, related: Scored[], unrelated: Scored[]): { related: number[]; unrelated: number[] } {
  dump('related', related);
  dump('unrelated', unrelated);
  const r = related.map((x) => x.sim).sort((a, b) => a - b);
  const u = unrelated.map((x) => x.sim).sort((a, b) => a - b);
  console.log(`\n### ${name}`);
  console.log(
    `  related   min ${(r[0] ?? 0).toFixed(4)}  median ${(r[Math.floor(r.length / 2)] ?? 0).toFixed(4)}  max ${(r.at(-1) ?? 0).toFixed(4)}`,
  );
  console.log(
    `  unrelated min ${(u[0] ?? 0).toFixed(4)}  median ${(u[Math.floor(u.length / 2)] ?? 0).toFixed(4)}  max ${(u.at(-1) ?? 0).toFixed(4)}`,
  );
  console.log(`  weakest related: "${related.find((x) => x.sim === r[0])?.pair[0]}" -> ${(r[0] ?? 0).toFixed(4)}`);
  console.log(
    `  strongest unrelated: "${unrelated.find((x) => x.sim === u.at(-1))?.pair[0]}" -> ${(u.at(-1) ?? 0).toFixed(4)}`,
  );
  const gap = (r[0] ?? 0) - (u.at(-1) ?? 0);
  console.log(`  separation: ${gap > 0 ? `clean, gap ${gap.toFixed(4)}` : `OVERLAP of ${(-gap).toFixed(4)}`}`);
  return { related: r, unrelated: u };
}

const q = report('query mode (question vs fact)', await score(QUERY_RELATED), await score(QUERY_UNRELATED));
const s = report(
  'statement mode (statement vs fact)',
  await score(STATEMENT_RELATED),
  await score(STATEMENT_UNRELATED),
);
console.log('\n### floors');
for (const [mode, m] of [
  ['query', q],
  ['statement', s],
] as const) {
  const inUse = floorFor(embedder.model, mode);
  const kept = m.related.filter((x) => x >= inUse).length;
  const admitted = m.unrelated.filter((x) => x >= inUse).length;
  const midpoint = ((m.related[0] ?? 0) + (m.unrelated.at(-1) ?? 0)) / 2;
  console.log(
    `  ${mode.padEnd(9)} in use ${inUse.toFixed(2)} (midpoint here ${midpoint.toFixed(2)})  ` +
      `keeps ${kept}/${m.related.length} true matches, admits ${admitted}/${m.unrelated.length} false ones`,
  );
}
console.log(
  '\nA floor that admits a false match is the dangerous one: it puts an unrelated fact in front of\n' +
    'the model as though it answered the question. Losing a weak true match only costs recall.',
);
