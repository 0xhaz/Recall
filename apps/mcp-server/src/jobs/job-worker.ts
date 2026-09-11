import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import pg from 'pg';
import { APP_CONFIG, type AppConfig } from '../config.js';
import { ContextService } from '../context/context.service.js';
import { Db } from '../db/db.js';
import { Extractor } from '../extraction/extractor.js';
import { MaintenanceService } from '../maintenance/maintenance.service.js';
import { AbsenceWatcher } from '../routines/absence.service.js';
import { RoutineMiner } from '../routines/miner.service.js';
import { PresenceWatcher } from '../routines/presence.service.js';
import { enqueueOnce, JOBS_CHANNEL, type JobKind } from './queue.js';

const POLL_MS = 5_000;
const MAINTENANCE_CHECK_MS = 60 * 60_000;
const ABSENCE_CHECK_MS = 60_000;
const CONTEXT_CHECK_MS = 30_000;
const MAX_ATTEMPTS = 3;

interface JobRow {
  id: string;
  household_id: string;
  kind: JobKind;
  payload: Record<string, unknown>;
  attempts: number;
}

/**
 * Stateless LLM work behind a Postgres queue (architecture.md §7): claim with SKIP LOCKED,
 * retry with backoff, give up after three attempts. Wakes on NOTIFY, polls as a fallback.
 */
@Injectable()
export class JobWorker implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(JobWorker.name);
  private listener: pg.Client | undefined;
  private timer: NodeJS.Timeout | undefined;
  private maintenanceTimer: NodeJS.Timeout | undefined;
  private absenceTimer: NodeJS.Timeout | undefined;
  private contextTimer: NodeJS.Timeout | undefined;
  private draining: Promise<number> | undefined;
  private again = false;
  private stopped = false;

  constructor(
    @Inject(Db) private readonly db: Db,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(Extractor) private readonly extractor: Extractor,
    @Inject(MaintenanceService) private readonly maintenance: MaintenanceService,
    @Inject(RoutineMiner) private readonly miner: RoutineMiner,
    @Inject(AbsenceWatcher) private readonly absence: AbsenceWatcher,
    @Inject(ContextService) private readonly contexts: ContextService,
    @Inject(PresenceWatcher) private readonly presence: PresenceWatcher,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (!this.config.extractionWorker) return;
    this.listener = new pg.Client({ connectionString: this.config.databaseUrl });
    await this.listener.connect();
    this.listener.on('notification', () => this.kick());
    await this.listener.query(`LISTEN ${JOBS_CHANNEL}`);
    // Polling picks up retries whose backoff has elapsed, and any missed notification.
    this.timer = setInterval(() => this.kick(), POLL_MS);
    // Snapshots, compaction and routine mining run as ordinary jobs, queued at most once a day per household.
    this.maintenanceTimer = setInterval(() => this.scheduleMaintenance(), MAINTENANCE_CHECK_MS);
    // Missed check-ins are noticed within a minute of becoming late.
    this.absenceTimer = setInterval(() => {
      this.absence.check().catch((err: unknown) => this.logger.error(err));
    }, ABSENCE_CHECK_MS);
    // Debounce and exit holds finish on the clock, not on a new report: re-evaluate contexts in flux.
    this.contextTimer = setInterval(() => {
      this.refreshContexts().catch((err: unknown) => this.logger.error(err));
    }, CONTEXT_CHECK_MS);
    this.scheduleMaintenance();
    this.kick();
  }

  async onApplicationShutdown(): Promise<void> {
    this.stopped = true;
    clearInterval(this.timer);
    clearInterval(this.maintenanceTimer);
    clearInterval(this.absenceTimer);
    clearInterval(this.contextTimer);
    await this.draining?.catch(() => undefined);
    await this.listener?.end();
  }

  /** Run jobs until none are ready. Concurrent calls share the drain in progress. */
  drain(): Promise<number> {
    if (this.draining) {
      this.again = true;
      return this.draining;
    }
    this.draining = this.loop().finally(() => {
      this.draining = undefined;
    });
    return this.draining;
  }

  private kick(): void {
    this.drain().catch((err: unknown) => this.logger.error(err));
  }

  private scheduleMaintenance(): void {
    this.maintenance
      .schedule()
      .then((queued) => queued > 0 && this.kick())
      .then(() => this.maintenance.purgeDeparted())
      .catch((err: unknown) => this.logger.error(err));
  }

  private async refreshContexts(): Promise<void> {
    const households = await this.contexts.pending();
    for (const householdId of households) await enqueueOnce(this.db, householdId, 'context');
  }

  private async loop(): Promise<number> {
    let processed = 0;
    do {
      this.again = false;
      while (!this.stopped && (await this.runOne())) processed++;
    } while (this.again && !this.stopped);
    return processed;
  }

  private async runOne(): Promise<boolean> {
    // Jobs left 'running' by a crashed worker are reclaimed after five minutes.
    const { rows } = await this.db.query<JobRow>(
      `UPDATE job SET status = 'running', locked_at = now(), attempts = attempts + 1
        WHERE id = (
          SELECT id FROM job
           WHERE (status = 'queued' AND run_after <= now())
              OR (status = 'running' AND locked_at < now() - interval '5 minutes')
           ORDER BY id
           FOR UPDATE SKIP LOCKED
           LIMIT 1)
        RETURNING id, household_id, kind, payload, attempts`,
    );
    const job = rows[0];
    if (!job) return false;

    try {
      await this.handle(job);
      await this.db.query(`UPDATE job SET status = 'done', locked_at = NULL, last_error = NULL WHERE id = $1`, [
        job.id,
      ]);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const final = job.attempts >= MAX_ATTEMPTS;
      await this.db.query(
        `UPDATE job SET status = $2, locked_at = NULL, last_error = $3, run_after = now() + make_interval(secs => $4)
          WHERE id = $1`,
        [job.id, final ? 'failed' : 'queued', message, 5 * 2 ** job.attempts],
      );
      if (final) await this.onFailed(job);
      this.logger.warn(`job ${job.id} ${job.kind} attempt ${job.attempts} failed: ${message}`);
    }
    return true;
  }

  private async handle(job: JobRow): Promise<void> {
    switch (job.kind) {
      case 'extract':
        await this.extractor.extractUtterance(String(job.payload.utterance_id));
        return;
      case 'maintain':
        await this.maintenance.maintain(job.household_id);
        return;
      case 'embed':
        await this.extractor.embedMissing(job.household_id);
        return;
      case 'mine':
        await this.miner.mine(job.household_id);
        return;
      case 'context':
        await this.contexts.evaluate(job.household_id);
        return;
      case 'presence':
        await this.presence.check(job.household_id);
        return;
      default:
        throw new Error(`Unknown job kind ${job.kind satisfies never}`);
    }
  }

  private async onFailed(job: JobRow): Promise<void> {
    if (job.kind === 'extract') {
      // The statement stays searchable as a pending utterance; nothing is lost.
      await this.db.query(`UPDATE utterance SET status = 'failed', processed_at = now() WHERE id = $1`, [
        job.payload.utterance_id,
      ]);
    }
  }
}
