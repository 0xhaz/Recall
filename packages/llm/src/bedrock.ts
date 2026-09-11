import { type ChatRequest, type ChatResponse, LlmNotConfiguredError, type LlmProvider } from './provider.js';

/**
 * Bedrock adapter (Nova Lite for extraction). Stubbed in week 1; implemented with the
 * Bedrock Runtime Converse API once AWS credits land (workplan WS13).
 */
export class BedrockProvider implements LlmProvider {
  readonly name = 'bedrock';

  constructor(
    readonly region: string,
    readonly model: string,
  ) {}

  async chat(_request: ChatRequest): Promise<ChatResponse> {
    throw new LlmNotConfiguredError(
      `Bedrock adapter not implemented yet (region ${this.region}, model ${this.model}); use LLM_PROVIDER=ollama`,
    );
  }

  async ping(): Promise<boolean> {
    return false;
  }
}
