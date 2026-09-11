import { type DynamicModule, Module } from '@nestjs/common';
import { createLlmProvider } from '@recall/llm';
import { HouseholdAuth } from './auth/household-auth.js';
import { APP_CONFIG, type AppConfig } from './config.js';
import { Db } from './db/db.js';
import { HealthController, LLM_PROVIDER } from './health.controller.js';
import { McpController } from './mcp/mcp.controller.js';
import { MemoryService } from './memory/memory.service.js';

// Convention: every constructor dependency uses an explicit @Inject(token). tsx and vitest
// compile with esbuild, which doesn't emit decorator metadata, so type-based injection would break.
@Module({})
// biome-ignore lint/complexity/noStaticOnlyClass: Nest dynamic modules are classes with a static factory.
export class AppModule {
  static register(config: AppConfig): DynamicModule {
    return {
      module: AppModule,
      controllers: [McpController, HealthController],
      providers: [
        { provide: APP_CONFIG, useValue: config },
        { provide: LLM_PROVIDER, useFactory: () => createLlmProvider() },
        Db,
        HouseholdAuth,
        MemoryService,
      ],
    };
  }
}
