import assert from 'node:assert/strict';

import { ok } from 'neverthrow';

import App from '../../app.ts';
import { CONTENTFUL_STATUS_CODES } from '../../constants/http.ts';
import { createDatabaseOnlyContext } from '../../context.ts';
import { CARD_IMAGE_STATUSES, cardImage } from '../../db/schema/card-images.ts';
import env from '../../env.ts';
import { integrationTest } from '../../tests/fixtures.ts';
import { CardImageMaterializer } from '../materializer.ts';
import type { CardImageOriginClient, CardImageOriginResult } from '../origin-client.ts';
import { CardImageRepository } from '../repository.ts';
import { CardImageWarmer } from '../warmer.ts';

describe('Card image proxy integration', () => {
  integrationTest('allows one lease owner and rejects stale completion', async ({ db }) => {
    const imageKey = 'c'.repeat(64);
    const repository = new CardImageRepository(createDatabaseOnlyContext(db));
    await db.insert(cardImage).values({
      imageKey,
      originUrl: 'https://images.example.com/lease.png',
      storageKey: 'card-images/lease',
    });

    const [first, second] = await Promise.all([
      repository.claim(imageKey, 'worker-one'),
      repository.claim(imageKey, 'worker-two'),
    ]);

    const claimed = [first, second].filter(row => row != null);

    const staleCompletion = await repository.markReady(imageKey, 'stale-worker', {
      contentType: 'image/png',
      contentLength: 3,
      checksum: 'checksum',
    });

    expect(claimed).toHaveLength(1);
    expect(staleCompletion).toBe(false);
    expect((await repository.getByImageKey(imageKey))?.status).toBe('fetching');
  });

  integrationTest(
    'waits for an in-flight warmer instead of returning a placeholder response',
    async ({ db, storageClient }) => {
      const imageKey = 'a'.repeat(64);
      const origin = new BlockingImageOriginClient();
      const repository = new CardImageRepository(createDatabaseOnlyContext(db));

      const cardImageMaterializer = new CardImageMaterializer({
        repository,
        storageClient,
        imageOriginClient: origin,
      });

      const cardImageWarmer = new CardImageWarmer({ repository, materializer: cardImageMaterializer, concurrency: 1 });

      const { app } = new App({
        db,
        storageClient,
        imageOriginClient: origin,
        cardImageMaterializer,
        cardImageWarmer,
      });

      const [row] = await db
        .insert(cardImage)
        .values({ imageKey, originUrl: 'https://images.example.com/test.png', storageKey: 'card-images/test' })
        .returning();

      assert(row != null, 'Expected the image row to be inserted');

      cardImageWarmer.notifyRegistered(1);
      await origin.started;
      const responsePromise = app.request(`/app-api/images/${imageKey}`);
      origin.release();

      const response = await responsePromise;
      expect(response.status).toBe(CONTENTFUL_STATUS_CODES.OK);
      expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
      expect(origin.callCount).toBe(1);
    },
  );

  integrationTest('reports an image that ran out of attempts as missing', async ({ db, app }) => {
    const imageKey = 'e'.repeat(64);
    await db.insert(cardImage).values({
      imageKey,
      originUrl: 'https://images.example.com/exhausted.png',
      storageKey: 'card-images/exhausted',
      status: CARD_IMAGE_STATUSES.FAILED,
      attemptCount: env.CARD_IMAGE_MAX_ATTEMPTS,
      lastErrorCode: 'origin_http_error',
    });

    const response = await app.request(`/app-api/images/${imageKey}`);

    expect(response.status).toBe(CONTENTFUL_STATUS_CODES.NOT_FOUND);
  });

  integrationTest('does not hold a database transaction while downloading an image', async ({ db, storageClient }) => {
    const imageKey = 'b'.repeat(64);
    const origin = new BlockingImageOriginClient();
    const repository = new CardImageRepository(createDatabaseOnlyContext(db));

    const cardImageMaterializer = new CardImageMaterializer({
      repository,
      storageClient,
      imageOriginClient: origin,
    });

    const { app } = new App({ db, storageClient, imageOriginClient: origin, cardImageMaterializer });
    await db.insert(cardImage).values({
      imageKey,
      originUrl: 'https://images.example.com/blocked.png',
      storageKey: 'card-images/blocked',
    });

    const responsePromise = app.request(`/app-api/images/${imageKey}`);
    await origin.started;

    const databaseRead = await Promise.race([
      repository.getByImageKey(imageKey),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Database read was starved')), 500)),
    ]);

    origin.release();

    expect(databaseRead?.status).toBe('fetching');
    expect((await responsePromise).status).toBe(CONTENTFUL_STATUS_CODES.OK);
  });

  integrationTest('logs each origin image fetch', async ({ db, storageClient, getLogsForRequestId, withRequestId }) => {
    const imageKey = 'd'.repeat(64);
    const origin = new BlockingImageOriginClient();
    const repository = new CardImageRepository(createDatabaseOnlyContext(db));

    const cardImageMaterializer = new CardImageMaterializer({
      repository,
      storageClient,
      imageOriginClient: origin,
    });

    const { app } = new App({ db, storageClient, imageOriginClient: origin, cardImageMaterializer });
    await db.insert(cardImage).values({
      imageKey,
      originUrl: 'https://images.example.com/logged.png',
      storageKey: 'card-images/logged',
    });
    const { headers, requestId } = withRequestId();

    origin.release();
    const response = await app.request(`/app-api/images/${imageKey}`, { headers });

    expect(response.status).toBe(CONTENTFUL_STATUS_CODES.OK);
    expect(getLogsForRequestId(requestId)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: 'images.origin_fetch.completed',
          outcome: 'success',
          image_key: imageKey,
          attempt: 1,
          trigger: 'proxy',
          content_length: 3,
          content_type: 'image/png',
          duration_ms: expect.any(Number),
        }),
      ]),
    );
  });
});

class BlockingImageOriginClient implements CardImageOriginClient {
  private readonly releaseGate = deferred<undefined>();
  private readonly startedGate = deferred<undefined>();
  callCount = 0;
  readonly started = this.startedGate.promise;

  async fetchImage(): Promise<CardImageOriginResult> {
    this.callCount += 1;
    this.startedGate.resolve(undefined);
    await this.releaseGate.promise;

    return ok({ body: new Uint8Array([1, 2, 3]), contentType: 'image/png' });
  }

  release() {
    this.releaseGate.resolve(undefined);
  }
}

function deferred<T>() {
  let resolve: (value: T | PromiseLike<T>) => void = () => {};

  const promise = new Promise<T>(resolver => {
    resolve = resolver;
  });

  return { promise, resolve };
}
