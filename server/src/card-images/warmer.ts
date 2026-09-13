import crypto from 'node:crypto';

import { processImagesLogger } from './logging.ts';
import { CARD_IMAGE_MATERIALIZATION_TRIGGERS, type CardImageMaterializer } from './materializer.ts';
import type { CardImageRepository, CardImageRow } from './repository.ts';
import env from '../env.ts';

// Identifies this process in lease owners so a stuck lease can be traced back to an instance.
const INSTANCE_ID = crypto.randomUUID();

interface CardImageWarmerDependencies {
  repository: CardImageRepository;
  materializer: CardImageMaterializer;
  concurrency?: number;
}

/**
 * Drains the card image work queue.
 *
 * The queue lives entirely in the `card_image` table: work is claimed with a lease rather than
 * held in memory, so several instances can run this concurrently and partition the queue between
 * them, and nothing is lost when a process restarts mid-flight.
 *
 * Note that `CARD_IMAGE_WARM_CONCURRENCY` is per instance, so origin load is that multiplied by
 * the number of instances running the warmer.
 */
export class CardImageWarmer {
  private readonly dependencies: CardImageWarmerDependencies;
  private readonly idleResolvers: (() => void)[] = [];
  private timeout: NodeJS.Timeout | undefined;
  private started = false;
  private activeWorkers = 0;
  private cycleRunning = false;
  private rescanRequested = false;

  constructor(dependencies: CardImageWarmerDependencies) {
    this.dependencies = dependencies;
  }

  notifyRegistered(count: number): void {
    if (count === 0) {
      return;
    }

    processImagesLogger().info(
      { event: 'images.warm.queued', outcome: 'success', result_count: count },
      'Registered card images for warming.',
    );
    void this.cycle();
  }

  start(options: { keepProcessAlive?: boolean } = {}): void {
    if (this.started) {
      return;
    }

    this.started = true;
    processImagesLogger().info(
      { event: 'images.warm.started', outcome: 'success', warm_concurrency: this.concurrency },
      'Started the card image warmer on this instance.',
    );
    void this.cycle();
    this.scheduleNextScan(options.keepProcessAlive ?? false);
  }

  stop(): void {
    this.started = false;

    if (this.timeout == null) {
      return;
    }

    clearTimeout(this.timeout);
    this.timeout = undefined;
  }

  idle(): Promise<void> {
    if (!this.cycleRunning && this.activeWorkers === 0) {
      return Promise.resolve();
    }

    return new Promise(resolve => this.idleResolvers.push(resolve));
  }

  private get concurrency(): number {
    return this.dependencies.concurrency ?? env.CARD_IMAGE_WARM_CONCURRENCY;
  }

  private scheduleNextScan(keepProcessAlive: boolean): void {
    if (!this.started) {
      return;
    }

    // Jittered so several instances do not poll the queue in lockstep.
    const delay = env.CARD_IMAGE_WORKER_POLL_INTERVAL_MS * (0.5 + Math.random());

    this.timeout = setTimeout(() => {
      void this.cycle();
      this.scheduleNextScan(keepProcessAlive);
    }, delay);

    if (!keepProcessAlive) {
      this.timeout.unref();
    }
  }

  /**
   * Only one cycle runs at a time; a wake arriving while one is in flight sets `rescanRequested`
   * so the running cycle loops again rather than starting a second one.
   */
  private async cycle(): Promise<void> {
    if (this.cycleRunning) {
      this.rescanRequested = true;

      return;
    }

    this.cycleRunning = true;

    try {
      let keepClaiming = true;

      while (keepClaiming) {
        this.rescanRequested = false;
        const capacity = this.concurrency - this.activeWorkers;

        if (capacity <= 0) {
          // A worker finishing re-enters the cycle, so there is nothing to wait for here.
          break;
        }

        const leaseOwner = `${INSTANCE_ID}:${crypto.randomUUID()}`;
        const claimed = await this.dependencies.repository.claimBatch(leaseOwner, capacity);

        for (const row of claimed) {
          this.activeWorkers += 1;
          void this.run(row, leaseOwner);
        }

        keepClaiming = this.rescanRequested;
      }
    } catch (err) {
      processImagesLogger().error(
        { event: 'images.warm.queued', outcome: 'failure', error_code: 'CARD_IMAGE_QUEUE_FAILED', err },
        'Failed to claim card images requiring warming.',
      );
    } finally {
      this.cycleRunning = false;
      this.settleIdle();
    }
  }

  private async run(row: CardImageRow, leaseOwner: string): Promise<void> {
    const startedAt = performance.now();

    try {
      const result = await this.dependencies.materializer.materializeClaimed(row, leaseOwner, {
        logger: processImagesLogger(),
        trigger: CARD_IMAGE_MATERIALIZATION_TRIGGERS.WORKER,
      });

      processImagesLogger().info(
        {
          event: 'images.warm.completed',
          outcome: 'success',
          image_key: row.imageKey,
          lease_owner: leaseOwner,
          attempt: row.attemptCount,
          materialization_status: result.status,
          duration_ms: Math.round(performance.now() - startedAt),
        },
        'Completed card image warming.',
      );
    } catch (err) {
      processImagesLogger().error(
        {
          event: 'images.warm.completed',
          outcome: 'failure',
          error_code: 'CARD_IMAGE_WARM_FAILED',
          image_key: row.imageKey,
          lease_owner: leaseOwner,
          attempt: row.attemptCount,
          duration_ms: Math.round(performance.now() - startedAt),
          err,
        },
        'Card image warming failed unexpectedly.',
      );
    } finally {
      this.activeWorkers -= 1;
      // Always hand back to `cycle()`; it owns settling idle so the two cannot race.
      void this.cycle();
    }
  }

  private settleIdle(): void {
    if (this.cycleRunning || this.activeWorkers !== 0) {
      return;
    }

    for (const resolve of this.idleResolvers.splice(0)) {
      resolve();
    }
  }
}
