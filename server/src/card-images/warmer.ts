import { processImagesLogger } from './logging.ts';
import { CARD_IMAGE_MATERIALIZATION_TRIGGERS, type CardImageMaterializer } from './materializer.ts';
import type { CardImageRepository, CardImageRow } from './repository.ts';
import env from '../env.ts';

export class CardImageWarmer {
  private readonly dependencies: {
    repository: CardImageRepository;
    materializer: CardImageMaterializer;
    concurrency?: number;
  };
  private readonly queuedKeys = new Set<string>();
  private readonly idleResolvers: (() => void)[] = [];
  private interval: NodeJS.Timeout | undefined;
  private activeWorkers = 0;

  constructor(dependencies: {
    repository: CardImageRepository;
    materializer: CardImageMaterializer;
    concurrency?: number;
  }) {
    this.dependencies = dependencies;
  }

  enqueue(jobs: CardImageRow[]): void {
    if (jobs.length === 0) return;
    for (const job of jobs) this.queuedKeys.add(job.imageKey);
    processImagesLogger().info(
      { event: 'images.warm.queued', outcome: 'success', result_count: jobs.length },
      'Queued card images for warming.',
    );
    this.pump();
  }

  start(options: { keepProcessAlive?: boolean } = {}): void {
    if (this.interval != null) return;
    void this.scan();
    this.interval = setInterval(() => void this.scan(), env.CARD_IMAGE_WORKER_POLL_INTERVAL_MS);
    if (!options.keepProcessAlive) this.interval.unref();
  }

  stop(): void {
    if (this.interval == null) return;
    clearInterval(this.interval);
    this.interval = undefined;
  }

  idle(): Promise<void> {
    if (this.queuedKeys.size === 0 && this.activeWorkers === 0) return Promise.resolve();
    return new Promise(resolve => this.idleResolvers.push(resolve));
  }

  private async scan(): Promise<void> {
    try {
      this.enqueue(await this.dependencies.repository.listPending());
    } catch (err) {
      processImagesLogger().error(
        { event: 'images.warm.queued', outcome: 'failure', error_code: 'CARD_IMAGE_QUEUE_FAILED', err },
        'Failed to scan for card images requiring warming.',
      );
    }
  }

  private pump(): void {
    const concurrency = this.dependencies.concurrency ?? env.CARD_IMAGE_WARM_CONCURRENCY;
    while (this.activeWorkers < concurrency) {
      const imageKey = this.queuedKeys.values().next().value;
      if (imageKey == null) break;
      this.queuedKeys.delete(imageKey);
      this.activeWorkers += 1;
      void this.run(imageKey);
    }
  }

  private async run(imageKey: string): Promise<void> {
    const startedAt = performance.now();
    try {
      const result = await this.dependencies.materializer.materialize(imageKey, {
        logger: processImagesLogger(),
        trigger: CARD_IMAGE_MATERIALIZATION_TRIGGERS.WORKER,
      });
      processImagesLogger().info(
        {
          event: 'images.warm.completed',
          outcome: 'success',
          image_key: imageKey,
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
          image_key: imageKey,
          duration_ms: Math.round(performance.now() - startedAt),
          err,
        },
        'Card image warming failed unexpectedly.',
      );
    } finally {
      this.activeWorkers -= 1;
      this.pump();
      if (this.queuedKeys.size === 0 && this.activeWorkers === 0) {
        for (const resolve of this.idleResolvers.splice(0)) resolve();
      }
    }
  }
}
