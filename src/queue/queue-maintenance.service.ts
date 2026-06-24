import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectQueue } from '@nestjs/bull';
import type { Queue, Job } from 'bull';
import {
  QUEUE_EMAIL,
  QUEUE_CONTRACT_EVENTS,
  QUEUE_ANALYTICS,
  QUEUE_EXPORT,
} from './queue.constants';
import { PrismaService } from '../prisma/prisma.service';
import * as Sentry from '@sentry/node';
import client from 'prom-client';

const DEAD_JOB_RETENTION_DAYS = 30; // prune failed jobs older than this

@Injectable()
export class QueueMaintenanceService implements OnModuleInit {
  private readonly logger = new Logger(QueueMaintenanceService.name);
  private deadLetterGauge: client.Gauge<string>;

  constructor(
    @InjectQueue(QUEUE_EMAIL) private readonly emailQueue: Queue,
    @InjectQueue(QUEUE_CONTRACT_EVENTS)
    private readonly contractEventsQueue: Queue,
    @InjectQueue(QUEUE_ANALYTICS) private readonly analyticsQueue: Queue,
    @InjectQueue(QUEUE_EXPORT) private readonly exportQueue: Queue,
    private readonly prisma: PrismaService,
  ) {
    this.deadLetterGauge = new client.Gauge({
      name: 'bull_dead_letter_count',
      help: 'Number of failed (dead) jobs in Bull by queue',
      labelNames: ['queue'],
    });
  }

  onModuleInit(): void {
    const dsn = process.env.SENTRY_DSN;
    if (dsn) {
      Sentry.init({ dsn, environment: process.env.NODE_ENV });
      this.logger.log('Sentry initialized for queue maintenance');
    }
    // update metrics immediately on startup
    void this.updateMetrics();
  }

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async handleDailyMaintenance(): Promise<void> {
    this.logger.log('Running daily queue maintenance');
    const queues: Array<{ q: Queue; name: string }> = [
      { q: this.emailQueue, name: QUEUE_EMAIL },
      { q: this.contractEventsQueue, name: QUEUE_CONTRACT_EVENTS },
      { q: this.analyticsQueue, name: QUEUE_ANALYTICS },
      { q: this.exportQueue, name: QUEUE_EXPORT },
    ];

    for (const { q, name } of queues) {
      try {
        await this.pruneFailedJobs(q, name);
      } catch (err) {
        this.logger.error(
          `Maintenance failed for queue ${name}: ${String(err)}`,
        );
        Sentry.captureException(err);
      }
    }

    await this.updateMetrics();
    this.logger.log('Daily queue maintenance complete');
  }

  private async updateMetrics(): Promise<void> {
    const queues: Array<{ q: Queue; name: string }> = [
      { q: this.emailQueue, name: QUEUE_EMAIL },
      { q: this.contractEventsQueue, name: QUEUE_CONTRACT_EVENTS },
      { q: this.analyticsQueue, name: QUEUE_ANALYTICS },
      { q: this.exportQueue, name: QUEUE_EXPORT },
    ];

    for (const { q, name } of queues) {
      try {
        const counts = await q.getJobCounts();
        const failed = (counts && (counts as any).failed) || 0;
        this.deadLetterGauge.set({ queue: name }, failed as number);
      } catch (err) {
        this.logger.warn(
          `Unable to update dead-letter metric for ${name}: ${String(err)}`,
        );
      }
    }
  }

  private async pruneFailedJobs(queue: Queue, queueName: string) {
    const retentionMs = DEAD_JOB_RETENTION_DAYS * 24 * 60 * 60 * 1000;
    // fetch recent failed jobs (bounded scan)
    const failedJobs: Job[] = await queue.getFailed(0, 10000);
    const now = Date.now();

    for (const job of failedJobs) {
      try {
        const created = job.timestamp || 0;
        if (now - created > retentionMs) {
          // persist a write-only dead letter record to Postgres
          await this.prisma.$transaction(async () => {
            await this.prisma.$executeRaw`SELECT 1`;
            await this.prisma.deadLetter.create({
              data: {
                queueName,
                jobId: String(job.id),
                payload: job.data,
                errorMessage:
                  (job.stacktrace && job.stacktrace.join('\n')) ||
                  job.failedReason ||
                  null,
                failedAt: new Date(job.timestamp || Date.now()),
              },
            });
          });

          // optionally report to Sentry for quick visibility
          if (process.env.SENTRY_DSN) {
            Sentry.captureMessage(`Pruned failed job from ${queueName}`, {
              level: 'warning',
              extra: { jobId: job.id, queue: queueName, data: job.data },
            });
          }

          // remove the job from Redis

          await job.remove();
        }
      } catch (err) {
        this.logger.error(
          `Error pruning job ${job.id} from ${queueName}: ${String(err)}`,
        );
        Sentry.captureException(err);
      }
    }
  }
}
