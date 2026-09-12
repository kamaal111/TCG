import { CardImageNotFound, CardImageStorageUnavailable } from './exceptions.ts';
import { imagesLogger } from './logging.ts';
import {
  CARD_IMAGE_MATERAILIZATION_STATUSES,
  CARD_IMAGE_MATERIALIZATION_TRIGGERS,
  type MaterializedImage,
} from './materializer.ts';
import type { CardImageRepository, CardImageRow } from './repository.ts';
import { CONTENTLESS_STATUS_CODES } from '../constants/http.ts';
import type { HonoContext } from '../context.ts';
import env from '../env.ts';
import { OBJECT_STORAGE_ERROR_REASONS, type ObjectStorageClient } from '../storage/client.ts';

export class CardImageService {
  private readonly c: HonoContext;

  constructor(c: HonoContext) {
    this.c = c;
  }

  async get(imageKey: string): Promise<Response> {
    const startedAt = performance.now();
    const row = await this.repository.getByImageKey(imageKey);
    if (row == null) throw new CardImageNotFound(this.c);

    if (row.status === 'ready') {
      const response = await this.readStored(row);
      if (response != null) {
        this.logCompleted(imageKey, 'hit', startedAt);
        return response;
      }
      await this.repository.resetMissingObject(imageKey);
    }

    this.logger.info(
      {
        event: 'images.materialize.started',
        outcome: 'success',
        image_key: imageKey,
        trigger: CARD_IMAGE_MATERIALIZATION_TRIGGERS.PROXY,
      },
      'Started cold card image materialization.',
    );
    const result = await withTimeout(
      this.c.get('cardImageMaterializer').materialize(imageKey, {
        logger: this.logger,
        trigger: CARD_IMAGE_MATERIALIZATION_TRIGGERS.PROXY,
      }),
      env.CARD_IMAGE_FOREGROUND_WAIT_MS,
    );
    if (result == null || result.status === CARD_IMAGE_MATERAILIZATION_STATUSES.BUSY) {
      this.logCompleted(imageKey, result == null ? 'timeout' : 'joined', startedAt, 'CARD_IMAGE_BUSY');
      return this.c.json({ message: 'Card image is being prepared', code: 'CARD_IMAGE_BUSY' }, 503, {
        'Retry-After': '1',
      });
    }
    if (result.status === CARD_IMAGE_MATERAILIZATION_STATUSES.NOT_FOUND) throw new CardImageNotFound(this.c);
    if (result.status === CARD_IMAGE_MATERAILIZATION_STATUSES.FAILED) {
      this.logCompleted(imageKey, 'cold', startedAt, 'CARD_IMAGE_ORIGIN_UNAVAILABLE');
      if (!result.isRetryable) throw new CardImageNotFound(this.c);
      return this.c.json({ message: 'Card image is temporarily unavailable', code: 'CARD_IMAGE_BUSY' }, 503, {
        'Retry-After': '1',
      });
    }

    this.logCompleted(imageKey, 'cold', startedAt);
    return this.imageResponse(result.image);
  }

  private get repository(): CardImageRepository {
    return this.c.get('cardImageRepository');
  }

  private get storage(): ObjectStorageClient {
    return this.c.get('storageClient');
  }

  private get logger() {
    return imagesLogger(this.c);
  }

  private async readStored(row: CardImageRow): Promise<Response | undefined> {
    const etag = `"${row.checksum}"`;
    if (this.c.req.header('If-None-Match') === etag)
      return new Response(null, { status: CONTENTLESS_STATUS_CODES.NOT_MODIFIED, headers: this.headers(row, true) });
    const stored = await this.storage.get(row.storageKey);
    if (stored.isOk())
      return new Response(Buffer.from(stored.value.body), { status: 200, headers: this.headers(row, true) });
    if (stored.error.reason === OBJECT_STORAGE_ERROR_REASONS.NOT_FOUND) return undefined;
    throw new CardImageStorageUnavailable(this.c);
  }

  private imageResponse(image: MaterializedImage): Response {
    return new Response(Buffer.from(image.body), {
      status: 200,
      headers: this.headers(image, image.persisted),
    });
  }

  private headers(
    image: Pick<CardImageRow, 'checksum' | 'contentLength' | 'contentType'>,
    persisted: boolean,
  ): Headers {
    const headers = new Headers({
      'Cache-Control': persisted ? 'public, max-age=31536000, immutable' : 'no-store',
    });
    if (image.contentType != null) headers.set('Content-Type', image.contentType);
    if (image.contentLength != null) headers.set('Content-Length', String(image.contentLength));
    if (image.checksum != null) headers.set('ETag', `"${image.checksum}"`);
    return headers;
  }

  private logCompleted(
    imageKey: string,
    cacheStatus: 'cold' | 'hit' | 'joined' | 'timeout',
    startedAt: number,
    errorCode?: string,
  ): void {
    const durationMs = Math.round(performance.now() - startedAt);
    if (errorCode == null) {
      this.logger.info(
        {
          event: 'images.proxy.completed',
          outcome: 'success',
          image_key: imageKey,
          cache_status: cacheStatus,
          duration_ms: durationMs,
        },
        'Completed a card image proxy request.',
      );
    } else {
      this.logger.warn(
        {
          event: 'images.proxy.completed',
          outcome: 'failure',
          image_key: imageKey,
          cache_status: cacheStatus,
          duration_ms: durationMs,
          error_code: errorCode,
        },
        'Card image proxy request completed without an image.',
      );
    }
  }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T | undefined> {
  let timeout: number | NodeJS.Timeout | undefined = undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<undefined>(resolve => {
        timeout = setTimeout(resolve, timeoutMs);
      }),
    ]);
  } finally {
    if (timeout != null) clearTimeout(timeout);
  }
}
