import crypto from 'node:crypto';

import type { ImagesLogFields } from './logging.ts';
import type { CardImageOriginClient } from './origin-client.ts';
import type { CardImageRepository, CardImageRow } from './repository.ts';
import { CARD_IMAGE_STATUSES } from '../db/schema/card-images.ts';
import env from '../env.ts';
import type { DomainLogger } from '../logging/index.ts';
import type { ObjectStorageClient } from '../storage/client.ts';

export interface MaterializedImage {
  body: Uint8Array;
  checksum: string;
  contentLength: number;
  contentType: string;
  persisted: boolean;
}

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

interface MaterializationOptions {
  logger: DomainLogger<ImagesLogFields>;
  trigger: CardImageMaterializationTrigger;
}

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
    return this.singleFlight(imageKey, () => this.claimAndMaterialize(imageKey, options));
  }

  /**
   * The proxy registers in `inFlight` before it claims, so a batch claim can win the row while a
   * proxy request is queued behind the concurrency limiter. Joining that request without giving
   * the lease back would strand the row in `fetching` until the lease expired, leaving both
   * callers reporting `busy` for an image nobody was fetching.
   */
  async materializeClaimed(
    row: CardImageRow,
    leaseOwner: string,
    options: MaterializationOptions,
  ): Promise<CardImageMaterializationResult> {
    const existing = this.inFlight.get(row.imageKey);

    if (existing != null) {
      await this.dependencies.repository.releaseClaim(row.imageKey, leaseOwner);

      return existing;
    }

    return this.singleFlight(row.imageKey, () => this.materializeRow(row, leaseOwner, options));
  }

  private singleFlight(
    imageKey: string,
    operation: () => Promise<CardImageMaterializationResult>,
  ): Promise<CardImageMaterializationResult> {
    const existing = this.inFlight.get(imageKey);

    if (existing != null) {
      return existing;
    }

    const task = this.limiter.run(operation);
    this.inFlight.set(imageKey, task);

    const cleanup = () => {
      if (this.inFlight.get(imageKey) === task) {
        this.inFlight.delete(imageKey);
      }
    };

    void task.then(cleanup).catch(cleanup);

    return task;
  }

  private async claimAndMaterialize(
    imageKey: string,
    options: MaterializationOptions,
  ): Promise<CardImageMaterializationResult> {
    const leaseOwner = crypto.randomUUID();
    const row = await this.dependencies.repository.claim(imageKey, leaseOwner);

    if (row == null) {
      const current = await this.dependencies.repository.getByImageKey(imageKey);

      if (current == null || isExhausted(current)) {
        return { status: CARD_IMAGE_MATERAILIZATION_STATUSES.NOT_FOUND };
      }

      return { status: CARD_IMAGE_MATERAILIZATION_STATUSES.BUSY };
    }

    return this.materializeRow(row, leaseOwner, options);
  }

  private async materializeRow(
    row: CardImageRow,
    leaseOwner: string,
    options: MaterializationOptions,
  ): Promise<CardImageMaterializationResult> {
    const imageKey = row.imageKey;
    const originFetchStartedAt = performance.now();

    const fetched = await this.dependencies.imageOriginClient.fetchImage(row.originUrl).catch(err => {
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
        attemptCount: row.attemptCount,
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

    const storagePutStartedAt = performance.now();

    // A storage failure never withholds bytes we already hold; the row is marked failed so the
    // image is retried, and the response is served with `no-store` because it was not persisted.
    try {
      const stored = await this.dependencies.storageClient.put(
        row.storageKey,
        image.body,
        image.contentType,
        image.checksum,
      );

      if (stored.isErr()) {
        options.logger.warn(
          {
            event: 'images.storage.completed',
            outcome: 'failure',
            error_code: `storage_${stored.error.reason}`,
            image_key: imageKey,
            trigger: options.trigger,
            duration_ms: Math.round(performance.now() - storagePutStartedAt),
            is_retryable: stored.error.isRetryable,
          },
          'Failed to store a card image.',
        );
        await this.dependencies.repository.markFailed(imageKey, leaseOwner, {
          code: `storage_${stored.error.reason}`,
          message: stored.error.message,
          isRetryable: stored.error.isRetryable,
          attemptCount: row.attemptCount,
        });

        return { status: CARD_IMAGE_MATERAILIZATION_STATUSES.READY, image };
      }
    } catch (err) {
      options.logger.error(
        {
          event: 'images.storage.completed',
          outcome: 'failure',
          error_code: 'storage_unexpected',
          image_key: imageKey,
          trigger: options.trigger,
          duration_ms: Math.round(performance.now() - storagePutStartedAt),
          err,
        },
        'Storing a card image failed unexpectedly.',
      );
      await this.dependencies.repository.markFailed(imageKey, leaseOwner, {
        code: 'storage_unexpected',
        message: err instanceof Error ? err.message : String(err),
        isRetryable: true,
        attemptCount: row.attemptCount,
      });

      return { status: CARD_IMAGE_MATERAILIZATION_STATUSES.READY, image };
    }

    options.logger.info(
      {
        event: 'images.storage.completed',
        outcome: 'success',
        image_key: imageKey,
        trigger: options.trigger,
        duration_ms: Math.round(performance.now() - storagePutStartedAt),
        content_length: image.contentLength,
        content_type: image.contentType,
      },
      'Stored a card image.',
    );

    const persisted = await this.dependencies.repository.markReady(imageKey, leaseOwner, {
      contentType: image.contentType,
      contentLength: image.contentLength,
      checksum: image.checksum,
    });

    return { status: CARD_IMAGE_MATERAILIZATION_STATUSES.READY, image: { ...image, persisted } };
  }
}

/**
 * A row is out of attempts and will never be retried. A row currently being fetched is excluded:
 * claiming increments the count, so an in-flight attempt can legitimately sit at the cap.
 */
function isExhausted(row: CardImageRow): boolean {
  return row.attemptCount >= env.CARD_IMAGE_MAX_ATTEMPTS && row.status !== CARD_IMAGE_STATUSES.FETCHING;
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

    if (waiter != null) {
      waiter();
    } else {
      this.activeCount -= 1;
    }
  }
}
