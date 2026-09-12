import crypto from 'node:crypto';

import type { ImagesLogFields } from './logging.ts';
import type { CardImageOriginClient } from './origin-client.ts';
import type { CardImageRepository } from './repository.ts';
import env from '../env.ts';
import type { DomainLogger } from '../logging/index.ts';
import type { ObjectStorageClient } from '../storage/client.ts';

export type MaterializedImage = {
  body: Uint8Array;
  checksum: string;
  contentLength: number;
  contentType: string;
  persisted: boolean;
};

export const CARD_IMAGE_MATERAILIZATION_STATUSES = {
  READY: 'ready',
  BUSY: 'busy',
  NOT_FOUND: 'not_found',
  FAILED: 'failed',
} as const;

export type CardImageMaterializationStatus =
  (typeof CARD_IMAGE_MATERAILIZATION_STATUSES)[keyof typeof CARD_IMAGE_MATERAILIZATION_STATUSES];

type CardImageMaterializationResult =
  | { status: typeof CARD_IMAGE_MATERAILIZATION_STATUSES.READY; image: MaterializedImage }
  | { status: typeof CARD_IMAGE_MATERAILIZATION_STATUSES.BUSY }
  | { status: typeof CARD_IMAGE_MATERAILIZATION_STATUSES.NOT_FOUND }
  | { status: typeof CARD_IMAGE_MATERAILIZATION_STATUSES.FAILED; isRetryable: boolean };

export const CARD_IMAGE_MATERIALIZATION_TRIGGERS = {
  PROXY: 'proxy',
  WORKER: 'worker',
} as const;

export type CardImageMaterializationTrigger =
  (typeof CARD_IMAGE_MATERIALIZATION_TRIGGERS)[keyof typeof CARD_IMAGE_MATERIALIZATION_TRIGGERS];

type MaterializationOptions = {
  logger: DomainLogger<ImagesLogFields>;
  trigger: CardImageMaterializationTrigger;
};

export class CardImageMaterializer {
  private readonly dependencies: {
    repository: CardImageRepository;
    storageClient: ObjectStorageClient;
    imageOriginClient: CardImageOriginClient;
  };
  private readonly inFlight = new Map<string, Promise<CardImageMaterializationResult>>();
  private readonly limiter: AsyncLimiter;

  constructor(dependencies: {
    repository: CardImageRepository;
    storageClient: ObjectStorageClient;
    imageOriginClient: CardImageOriginClient;
  }) {
    this.dependencies = dependencies;
    this.limiter = new AsyncLimiter();
  }

  materialize(imageKey: string, options: MaterializationOptions): Promise<CardImageMaterializationResult> {
    const existing = this.inFlight.get(imageKey);
    if (existing != null) return existing;

    const task = this.limiter.run(() => this.performMaterialization(imageKey, options));
    this.inFlight.set(imageKey, task);
    const cleanup = () => {
      if (this.inFlight.get(imageKey) === task) {
        this.inFlight.delete(imageKey);
      }
    };
    void task.then(cleanup).catch(cleanup);
    return task;
  }

  private async performMaterialization(
    imageKey: string,
    options: MaterializationOptions,
  ): Promise<CardImageMaterializationResult> {
    const leaseOwner = crypto.randomUUID();
    const row = await this.dependencies.repository.claim(imageKey, leaseOwner);
    if (row == null) {
      const current = await this.dependencies.repository.getByImageKey(imageKey);
      if (current == null) return { status: CARD_IMAGE_MATERAILIZATION_STATUSES.NOT_FOUND };
      return { status: CARD_IMAGE_MATERAILIZATION_STATUSES.BUSY };
    }

    const originFetchStartedAt = performance.now();
    const fetched = await this.dependencies.imageOriginClient.fetchImage(row.originUrl).catch((err: unknown) => {
      options.logger.error(
        {
          event: 'images.origin_fetch.completed',
          outcome: 'failure',
          error_code: 'ORIGIN_FETCH_UNEXPECTED',
          image_key: imageKey,
          attempt: row.attemptCount,
          trigger: options.trigger,
          duration_ms: Math.round(performance.now() - originFetchStartedAt),
          err,
        },
        'Card image origin fetch failed unexpectedly.',
      );
      throw err;
    });
    if (fetched.isErr()) {
      options.logger.warn(
        {
          event: 'images.origin_fetch.completed',
          outcome: 'failure',
          error_code: `origin_${fetched.error.reason}`,
          image_key: imageKey,
          attempt: row.attemptCount,
          trigger: options.trigger,
          duration_ms: Math.round(performance.now() - originFetchStartedAt),
          is_retryable: fetched.error.isRetryable,
          origin_status_code: fetched.error.statusCode,
        },
        'Card image origin fetch failed.',
      );
      await this.dependencies.repository.markFailed(imageKey, leaseOwner, {
        code: `origin_${fetched.error.reason}`,
        message: fetched.error.message,
        isRetryable: fetched.error.isRetryable,
      });
      return { status: CARD_IMAGE_MATERAILIZATION_STATUSES.FAILED, isRetryable: fetched.error.isRetryable };
    }
    options.logger.info(
      {
        event: 'images.origin_fetch.completed',
        outcome: 'success',
        image_key: imageKey,
        attempt: row.attemptCount,
        trigger: options.trigger,
        duration_ms: Math.round(performance.now() - originFetchStartedAt),
        content_length: fetched.value.body.byteLength,
        content_type: fetched.value.contentType,
      },
      'Fetched card image from origin.',
    );

    const checksum = crypto.createHash('sha256').update(fetched.value.body).digest('hex');
    const image: MaterializedImage = {
      body: fetched.value.body,
      checksum,
      contentLength: fetched.value.body.byteLength,
      contentType: fetched.value.contentType,
      persisted: false,
    };
    try {
      const stored = await this.dependencies.storageClient.put(
        row.storageKey,
        image.body,
        image.contentType,
        image.checksum,
      );
      if (stored.isErr()) {
        await this.dependencies.repository.markFailed(imageKey, leaseOwner, {
          code: `storage_${stored.error.reason}`,
          message: stored.error.message,
          isRetryable: stored.error.isRetryable,
        });
        return { status: CARD_IMAGE_MATERAILIZATION_STATUSES.READY, image };
      }
    } catch (error) {
      await this.dependencies.repository.markFailed(imageKey, leaseOwner, {
        code: 'storage_unexpected',
        message: error instanceof Error ? error.message : String(error),
        isRetryable: true,
      });
      return { status: CARD_IMAGE_MATERAILIZATION_STATUSES.READY, image };
    }

    const persisted = await this.dependencies.repository.markReady(imageKey, leaseOwner, {
      contentType: image.contentType,
      contentLength: image.contentLength,
      checksum: image.checksum,
    });
    return { status: CARD_IMAGE_MATERAILIZATION_STATUSES.READY, image: { ...image, persisted } };
  }
}

class AsyncLimiter {
  private activeCount = 0;
  private readonly waiters: (() => void)[] = [];

  async run<T>(operation: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await operation();
    } finally {
      this.release();
    }
  }

  private async acquire(): Promise<void> {
    if (this.activeCount < env.CARD_IMAGE_WARM_CONCURRENCY) {
      this.activeCount += 1;
      return;
    }
    await new Promise<void>(resolve => this.waiters.push(resolve));
  }

  private release(): void {
    const waiter = this.waiters.shift();
    if (waiter != null) waiter();
    else this.activeCount -= 1;
  }
}
