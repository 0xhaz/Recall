import { randomBytes } from 'node:crypto';
import { type DynamicModule, Module } from '@nestjs/common';
import { HybridClock } from '@recall/core';
import { createEmbedder, createLlmProvider, type Embedder, type LlmProvider } from '@recall/llm';
import { ActionService } from './actions/action.service.js';
import { ConsoleAuthController } from './auth/console-auth.controller.js';
import { ConsoleAuthService } from './auth/console-auth.service.js';
import { ConsoleEmailSender, EMAIL_SENDER, type EmailSender } from './auth/email.js';
import { HouseholdAuth } from './auth/household-auth.js';
import { HouseholdTokensController } from './auth/household-tokens.controller.js';
import { HouseholdTokens } from './auth/household-tokens.service.js';
import { CareService } from './care/care.service.js';
import { ReminderService } from './care/reminder.service.js';
import { ReminderWatcher } from './care/reminder.watcher.js';
import { APP_CONFIG, type AppConfig } from './config.js';
import { ConsoleController } from './console/console.controller.js';
import { ConsoleService } from './console/console.service.js';
import { ContextService } from './context/context.service.js';
import { MusicService } from './context/music.service.js';
import { Db } from './db/db.js';
import { DeviceService } from './devices/device.service.js';
import { CLOCK, EventLog } from './events/event-log.service.js';
import { Extractor } from './extraction/extractor.js';
import { HealthController } from './health.controller.js';
import { MembershipService } from './households/membership.service.js';
import { JobWorker } from './jobs/job-worker.js';
import { EMBEDDER, LLM_PROVIDER } from './llm/tokens.js';
import { UsageMeter } from './llm/usage-meter.js';
import { ModelWarmup } from './llm/warmup.js';
import { MaintenanceService } from './maintenance/maintenance.service.js';
import { McpController } from './mcp/mcp.controller.js';
import { McpTools } from './mcp/tools.js';
import { Eraser } from './memory/eraser.js';
import { ExplainService } from './memory/explain.service.js';
import { ForgetService } from './memory/forget.service.js';
import { MemoryService } from './memory/memory.service.js';
import { LatencyTracker, MetricsController } from './metrics/latency.js';
import { AbsenceWatcher } from './routines/absence.service.js';
import { CheckinService } from './routines/checkin.service.js';
import { RoutineMiner } from './routines/miner.service.js';
import { NoticeService } from './routines/notice.service.js';
import { PresenceWatcher } from './routines/presence.service.js';
import { RulesService } from './rules/rules.service.js';
import { SessionService } from './sessions/session.service.js';

/** Swap external dependencies in tests (scripted LLM, deterministic embedder, captured email). */
export interface AppOverrides {
  llm?: LlmProvider;
  embedder?: Embedder;
  emailSender?: EmailSender;
}

// Convention: every constructor dependency uses an explicit @Inject(token). tsx and vitest
// compile with esbuild, which doesn't emit decorator metadata, so type-based injection would break.
@Module({})
// biome-ignore lint/complexity/noStaticOnlyClass: Nest dynamic modules are classes with a static factory.
export class AppModule {
  static register(config: AppConfig, overrides: AppOverrides = {}): DynamicModule {
    return {
      module: AppModule,
      controllers: [
        McpController,
        HealthController,
        MetricsController,
        ConsoleAuthController,
        ConsoleController,
        HouseholdTokensController,
      ],
      providers: [
        { provide: APP_CONFIG, useValue: config },
        { provide: LLM_PROVIDER, useFactory: () => overrides.llm ?? createLlmProvider() },
        { provide: EMBEDDER, useFactory: () => overrides.embedder ?? createEmbedder() },
        { provide: EMAIL_SENDER, useFactory: () => overrides.emailSender ?? new ConsoleEmailSender() },
        // One clock per process; the random suffix keeps stamps from two instances distinct.
        { provide: CLOCK, useFactory: () => new HybridClock(`server-${randomBytes(3).toString('hex')}`) },
        Db,
        HouseholdAuth,
        HouseholdTokens,
        ConsoleAuthService,
        MembershipService,
        EventLog,
        DeviceService,
        SessionService,
        MemoryService,
        Eraser,
        ForgetService,
        ExplainService,
        RulesService,
        NoticeService,
        RoutineMiner,
        AbsenceWatcher,
        CheckinService,
        ContextService,
        MusicService,
        ActionService,
        CareService,
        ReminderService,
        ReminderWatcher,
        ConsoleService,
        PresenceWatcher,
        ModelWarmup,
        UsageMeter,
        Extractor,
        MaintenanceService,
        JobWorker,
        LatencyTracker,
        McpTools,
      ],
    };
  }
}
