import { processImagesLogger } from '../../card-images/logging.ts';
import type { CardImageMaterializer } from '../../card-images/materializer.ts';
import type { CardImageRepository } from '../../card-images/repository.ts';
import type { CardImageScheduler } from '../../card-images/scheduler.ts';
import { CardImageProcessor } from '../../card-images/warmer.ts';
import { DEFAULT_IMAGE_POLICY, type ApplicationConfig } from '../../config.ts';

export class CardImageWarmer implements CardImageScheduler {
  private readonly processor: CardImageProcessor;
  private readonly pollIntervalMs: number;
  private readonly concurrency: number;
  private timeout: ReturnType<typeof setTimeout> | undefined;
  private started = false;

  constructor(
    dependencies: { repository: CardImageRepository; materializer: CardImageMaterializer; concurrency?: number },
    config: Pick<
      ApplicationConfig,
      'CARD_IMAGE_WARM_CONCURRENCY' | 'CARD_IMAGE_WORKER_POLL_INTERVAL_MS'
    > = DEFAULT_IMAGE_POLICY,
  ) {
    this.concurrency = dependencies.concurrency ?? config.CARD_IMAGE_WARM_CONCURRENCY;
    this.pollIntervalMs = config.CARD_IMAGE_WORKER_POLL_INTERVAL_MS;
    this.processor = new CardImageProcessor({
      ...dependencies,
      concurrency: this.concurrency,
      logger: processImagesLogger(),
    });
  }

  notifyRegistered(count: number): void {
    this.processor.notifyRegistered(count);
  }

  idle(): Promise<void> {
    return this.processor.idle();
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
    void this.processor.processPending();
    this.scheduleNextScan(options.keepProcessAlive ?? false);
  }

  stop(): void {
    this.started = false;
    clearTimeout(this.timeout);
    this.timeout = undefined;
  }

  private scheduleNextScan(keepProcessAlive: boolean): void {
    if (!this.started) {
      return;
    }

    this.timeout = setTimeout(
      () => {
        void this.processor.processPending();
        this.scheduleNextScan(keepProcessAlive);
      },
      this.pollIntervalMs * (0.5 + Math.random()),
    );

    if (!keepProcessAlive) {
      this.timeout.unref();
    }
  }
}
