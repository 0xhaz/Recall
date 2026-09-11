import { type DynamicModule, Module } from '@nestjs/common';
import { createEmbedder, createLlmProvider, type Embedder, type LlmProvider } from '@recall/llm';
import { ConsoleAuthController } from './auth/console-auth.controller.js';
import { ConsoleAuthService } from './auth/console-auth.service.js';
import { ConsoleEmailSender, EMAIL_SENDER, type EmailSender } from './auth/email.js';
import { HouseholdAuth } from './auth/household-auth.js';
import { HouseholdTokensController } from './auth/household-tokens.controller.js';
import { HouseholdTokens } from './auth/household-tokens.service.js';
import { APP_CONFIG, type AppConfig } from './config.js';
import { Db } from './db/db.js';
import { Extractor } from './extraction/extractor.js';
import { HealthController } from './health.controller.js';
import { MembershipService } from './households/membership.service.js';
import { JobWorker } from './jobs/job-worker.js';
import { EMBEDDER, LLM_PROVIDER } from './llm/tokens.js';
import { UsageMeter } from './llm/usage-meter.js';
import { McpController } from './mcp/mcp.controller.js';
import { MemoryService } from './memory/memory.service.js';

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
      controllers: [McpController, HealthController, ConsoleAuthController, HouseholdTokensController],
      providers: [
        { provide: APP_CONFIG, useValue: config },
        { provide: LLM_PROVIDER, useFactory: () => overrides.llm ?? createLlmProvider() },
        { provide: EMBEDDER, useFactory: () => overrides.embedder ?? createEmbedder() },
        { provide: EMAIL_SENDER, useFactory: () => overrides.emailSender ?? new ConsoleEmailSender() },
        Db,
        HouseholdAuth,
        HouseholdTokens,
        ConsoleAuthService,
        MembershipService,
        MemoryService,
        UsageMeter,
        Extractor,
        JobWorker,
      ],
    };
  }
}
