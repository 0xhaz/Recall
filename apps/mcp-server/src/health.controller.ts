import { Controller, Get, Inject } from '@nestjs/common';
import type { LlmProvider } from '@recall/llm';
import { Db } from './db/db.js';
import { LLM_PROVIDER } from './llm/tokens.js';

@Controller('health')
export class HealthController {
  constructor(
    @Inject(Db) private readonly db: Db,
    @Inject(LLM_PROVIDER) private readonly llm: LlmProvider,
  ) {}

  @Get()
  async health() {
    const [db, llm] = await Promise.all([
      this.db.query('SELECT 1').then(
        () => true,
        () => false,
      ),
      this.llm.ping(),
    ]);
    return { ok: db, db, llm: { provider: this.llm.name, model: this.llm.model, reachable: llm } };
  }
}
