import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { HouseholdContext } from '../auth/household-auth.js';
import { DeviceService } from '../devices/device.service.js';
import { EventLog } from '../events/event-log.service.js';
import { ExplainService } from '../memory/explain.service.js';
import { ForgetService } from '../memory/forget.service.js';
import { MemoryService } from '../memory/memory.service.js';
import { LatencyTracker } from '../metrics/latency.js';
import { RulesService } from '../rules/rules.service.js';
import { SessionService } from '../sessions/session.service.js';
import { registerDeviceTools } from './device-tools.js';
import { registerMemoryTools } from './memory-tools.js';
import { registerRuleTools } from './rule-tools.js';
import type { Timed } from './tool-kit.js';

@Injectable()
export class McpTools {
  private readonly logger = new Logger('mcp');

  constructor(
    @Inject(MemoryService) private readonly memory: MemoryService,
    @Inject(ForgetService) private readonly forget: ForgetService,
    @Inject(ExplainService) private readonly explain: ExplainService,
    @Inject(RulesService) private readonly rules: RulesService,
    @Inject(EventLog) private readonly events: EventLog,
    @Inject(DeviceService) private readonly devices: DeviceService,
    @Inject(SessionService) private readonly sessions: SessionService,
    @Inject(LatencyTracker) private readonly latency: LatencyTracker,
  ) {}

  /** One MCP server per request (stateless Streamable HTTP), bound to the caller's household. */
  build(ctx: HouseholdContext): McpServer {
    const server = new McpServer({ name: 'recall', version: '0.3.0' });
    const timed: Timed = async (tool, fn) => {
      const started = performance.now();
      try {
        return await fn();
      } finally {
        const ms = performance.now() - started;
        this.latency.record(tool, ms);
        this.logger.log(`tool=${tool} ms=${ms.toFixed(1)}`);
      }
    };
    const { memory, forget, explain, rules, events, devices, sessions } = this;
    registerMemoryTools(server, ctx, { memory, devices, sessions, forget, explain, rules }, timed);
    registerRuleTools(server, ctx, { memory, rules }, timed);
    registerDeviceTools(server, ctx, { memory, events, devices, sessions }, timed);
    return server;
  }
}
