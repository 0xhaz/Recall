import { Inject, Injectable, type OnApplicationShutdown } from '@nestjs/common';
import pg from 'pg';
import { APP_CONFIG, type AppConfig } from '../config.js';

@Injectable()
export class Db implements OnApplicationShutdown {
  readonly pool: pg.Pool;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    // Persistent pool: connection setup must stay off the read path (architecture.md §7.1).
    this.pool = new pg.Pool({ connectionString: config.databaseUrl, max: 10 });
  }

  query<R extends pg.QueryResultRow>(text: string, params?: unknown[]): Promise<pg.QueryResult<R>> {
    return this.pool.query<R>(text, params);
  }

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}
