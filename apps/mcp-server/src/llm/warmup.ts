import { Inject, Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import type { Embedder } from '@recall/llm';
import { APP_CONFIG, type AppConfig } from '../config.js';
import { EMBEDDER } from './tokens.js';

/**
 * Load the embedding model at startup, so the first question after a restart doesn't wait for
 * it (measured: 1.7–3.7 s cold). Runs only where background work runs, never in tests.
 */
@Injectable()
export class ModelWarmup implements OnApplicationBootstrap {
  private readonly logger = new Logger(ModelWarmup.name);

  constructor(
    @Inject(EMBEDDER) private readonly embedder: Embedder,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  onApplicationBootstrap(): void {
    if (!this.config.extractionWorker) return;
    const started = performance.now();
    this.embedder
      .embed(['warm up'], 'query')
      .then(() => this.logger.log(`embedding model ready in ${Math.round(performance.now() - started)} ms`))
      .catch((err: unknown) => this.logger.warn(`embedding model not warmed: ${String(err)}`));
  }
}
