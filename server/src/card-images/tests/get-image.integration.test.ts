import { integrationTest } from './fixtures.ts';
import { CONTENTFUL_STATUS_CODES } from '../../constants/http.ts';
import env from '../../env.ts';
import { CARD_IMAGE_STATUSES } from '../types.ts';

describe('Card image proxy integration', () => {
  integrationTest(
    'allows one lease owner and rejects stale completion',
    async ({ imageRepository: repository, createImage }) => {
      const imageKey = 'c'.repeat(64);
      await createImage({
        imageKey,
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
    },
  );

  integrationTest(
    'waits for an in-flight warmer instead of returning a placeholder response',
    async ({
      createApp,
      imageOrigin: origin,
      imageMaterializer: cardImageMaterializer,
      createImageWarmer,
      createImage,
    }) => {
      const imageKey = 'a'.repeat(64);

      const cardImageWarmer = createImageWarmer({ concurrency: 1 });

      const app = createApp({
        imageOriginClient: origin,
        cardImageMaterializer,
        cardImageWarmer,
      });

      await createImage({ imageKey });

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

  integrationTest('reports an image that ran out of attempts as missing', async ({ app, createImage }) => {
    const imageKey = 'e'.repeat(64);
    await createImage({
      imageKey,
      status: CARD_IMAGE_STATUSES.FAILED,
      attemptCount: env.CARD_IMAGE_MAX_ATTEMPTS,
      lastErrorCode: 'origin_http_error',
    });

    const response = await app.request(`/app-api/images/${imageKey}`);

    expect(response.status).toBe(CONTENTFUL_STATUS_CODES.NOT_FOUND);
  });

  integrationTest(
    'does not hold a database transaction while downloading an image',
    async ({
      createApp,
      imageRepository: repository,
      imageOrigin: origin,
      imageMaterializer: cardImageMaterializer,
      createImage,
    }) => {
      const imageKey = 'b'.repeat(64);

      const app = createApp({ imageOriginClient: origin, cardImageMaterializer });
      await createImage({
        imageKey,
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
    },
  );

  integrationTest(
    'logs each origin image fetch',
    async ({
      getLogsForRequestId,
      withRequestId,
      createApp,
      imageOrigin: origin,
      imageMaterializer: cardImageMaterializer,
      createImage,
    }) => {
      const imageKey = 'd'.repeat(64);

      const app = createApp({ imageOriginClient: origin, cardImageMaterializer });
      await createImage({
        imageKey,
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
    },
  );
});
