import { Inject, Injectable } from '@nestjs/common';
import type { ChatRequest, ChatResponse, LlmProvider } from '@recall/llm';
import type { HouseholdContext } from '../auth/household-auth.js';
import { Db } from '../db/db.js';
import { LLM_PROVIDER } from './tokens.js';

/** Every LLM call goes through here so each household's usage is counted (free-tier protection, design.md §9). */
@Injectable()
export class UsageMeter {
  constructor(
    @Inject(Db) private readonly db: Db,
    @Inject(LLM_PROVIDER) private readonly llm: LlmProvider,
  ) {}

  async chat(ctx: HouseholdContext, purpose: string, request: ChatRequest): Promise<ChatResponse> {
    const response = await this.llm.chat(request);
    await this.db.query(
      `INSERT INTO llm_usage (household_id, region, day, purpose, calls, input_tokens, output_tokens)
       VALUES ($1, $2, current_date, $3, 1, $4, $5)
       ON CONFLICT (household_id, day, purpose) DO UPDATE SET
         calls = llm_usage.calls + 1,
         input_tokens = llm_usage.input_tokens + EXCLUDED.input_tokens,
         output_tokens = llm_usage.output_tokens + EXCLUDED.output_tokens`,
      [ctx.householdId, ctx.region, purpose, response.inputTokens, response.outputTokens],
    );
    return response;
  }
}
