import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ActionService } from '../actions/action.service.js';
import type { HouseholdContext } from '../auth/household-auth.js';
import { CareService } from '../care/care.service.js';
import { ReminderService } from '../care/reminder.service.js';
import { ContextService } from '../context/context.service.js';
import { MusicService } from '../context/music.service.js';
import { DeviceService } from '../devices/device.service.js';
import { EventLog } from '../events/event-log.service.js';
import { ExplainService } from '../memory/explain.service.js';
import { ForgetService } from '../memory/forget.service.js';
import { MemoryService } from '../memory/memory.service.js';
import { LatencyTracker } from '../metrics/latency.js';
import { CheckinService } from '../routines/checkin.service.js';
import { RoutineMiner } from '../routines/miner.service.js';
import { RulesService } from '../rules/rules.service.js';
import { SessionService } from '../sessions/session.service.js';
import { registerActionTools } from './action-tools.js';
import { registerCareTools } from './care-tools.js';
import { registerContextTools } from './context-tools.js';
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
    @Inject(CheckinService) private readonly checkins: CheckinService,
    @Inject(EventLog) private readonly events: EventLog,
    @Inject(DeviceService) private readonly devices: DeviceService,
    @Inject(SessionService) private readonly sessions: SessionService,
    @Inject(ContextService) private readonly contexts: ContextService,
    @Inject(MusicService) private readonly music: MusicService,
    @Inject(RoutineMiner) private readonly routines: RoutineMiner,
    @Inject(ActionService) private readonly actions: ActionService,
    @Inject(CareService) private readonly care: CareService,
    @Inject(ReminderService) private readonly reminders: ReminderService,
    @Inject(LatencyTracker) private readonly latency: LatencyTracker,
  ) {}

  /** One MCP server per request (stateless Streamable HTTP), bound to the caller's household. */
  build(ctx: HouseholdContext): McpServer {
    const server = new McpServer({ name: 'recall', version: '0.4.0' });
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
    const { memory, forget, explain, rules, checkins, events, devices, sessions } = this;
    const { contexts, music, routines, actions, care } = this;
    registerMemoryTools(server, ctx, { memory, devices, sessions, forget, explain, rules, contexts, care }, timed);
    registerRuleTools(server, ctx, { memory, rules }, timed);
    registerCareTools(server, ctx, { memory, checkins, care, reminders: this.reminders }, timed);
    registerContextTools(server, ctx, { memory, contexts, music, routines }, timed);
    registerActionTools(server, ctx, { memory, actions }, timed);
    registerDeviceTools(server, ctx, { memory, events, devices, sessions }, timed);
    return server;
  }
}
