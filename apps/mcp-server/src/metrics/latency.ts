import { Controller, Get, Inject, Injectable } from '@nestjs/common';

/** p95 budgets per tool (techstack.md §5). */
export const LATENCY_BUDGETS_MS: Record<string, number> = {
  session_brief: 400,
  recall: 300,
  remember: 100,
  device_state: 100,
  session_history: 100,
  list_rules: 100,
  get_context: 100,
  set_context: 100,
  suggest_music: 100,
  action_preflight: 200,
  propose_action: 200,
  decide_action: 100,
  undo: 100,
};

const WINDOW = 1000;

export interface LatencySummary {
  count: number;
  p50: number;
  p95: number;
  max: number;
  budget_p95: number | null;
}

/** Server-side time per tool over the last 1000 calls, published on /metrics/latency. */
@Injectable()
export class LatencyTracker {
  private readonly samples = new Map<string, number[]>();

  record(tool: string, ms: number): void {
    const samples = this.samples.get(tool) ?? [];
    samples.push(ms);
    if (samples.length > WINDOW) samples.shift();
    this.samples.set(tool, samples);
  }

  summary(): Record<string, LatencySummary> {
    return Object.fromEntries(
      [...this.samples.entries()].sort().map(([tool, samples]) => {
        const sorted = [...samples].sort((a, b) => a - b);
        return [
          tool,
          {
            count: sorted.length,
            p50: round(percentile(sorted, 0.5)),
            p95: round(percentile(sorted, 0.95)),
            max: round(sorted.at(-1) ?? 0),
            budget_p95: LATENCY_BUDGETS_MS[tool] ?? null,
          },
        ];
      }),
    );
  }
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))] ?? 0;
}

const round = (ms: number) => Math.round(ms * 10) / 10;

@Controller('metrics')
export class MetricsController {
  constructor(@Inject(LatencyTracker) private readonly latency: LatencyTracker) {}

  @Get('latency')
  latencyByTool() {
    return { tools: this.latency.summary() };
  }
}
