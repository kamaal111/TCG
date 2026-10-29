import { eq, inArray } from 'drizzle-orm';

import { integrationTest } from './fixtures.ts';
import { imageRecord } from './utils.ts';
import { cardImage } from '../../db/schema/card-images.ts';
import env from '../../env.ts';
import { CARD_IMAGE_STATUSES } from '../types.ts';

describe('CardImageRepository attempt accounting', () => {
  integrationTest(
    'clears the attempt count once an image is ready',
    async ({ imageRepository: repository, createImage }) => {
      const imageKey = '1'.repeat(64);
      await createImage({
        imageKey,
        attemptCount: env.CARD_IMAGE_MAX_ATTEMPTS - 1,
      });

      const claimed = await repository.claim(imageKey, 'worker');

      const markedReady = await repository.markReady(imageKey, 'worker', {
        contentType: 'image/png',
        contentLength: 3,
        checksum: 'checksum',
      });

      expect(claimed?.attemptCount).toBe(env.CARD_IMAGE_MAX_ATTEMPTS);
      expect(markedReady).toBe(true);
      expect((await repository.getByImageKey(imageKey))?.attemptCount).toBe(0);
    },
  );

  integrationTest(
    'makes an image claimable again after its stored object disappears',
    async ({ imageRepository: repository, createImage }) => {
      const imageKey = '2'.repeat(64);
      await createImage({
        imageKey,
        status: CARD_IMAGE_STATUSES.READY,
        contentType: 'image/png',
        contentLength: 3,
        checksum: 'checksum',
        attemptCount: env.CARD_IMAGE_MAX_ATTEMPTS,
        lastErrorCode: 'origin_http_error',
        lastError: 'boom',
      });

      await repository.resetMissingObject(imageKey);
      const afterReset = await repository.getByImageKey(imageKey);
      const reclaimed = await repository.claim(imageKey, 'worker');

      expect(afterReset?.attemptCount).toBe(0);
      expect(afterReset?.lastErrorCode).toBeNull();
      expect(reclaimed?.status).toBe(CARD_IMAGE_STATUSES.FETCHING);
    },
  );

  integrationTest(
    'stops claiming an image that exhausted its attempts',
    async ({ imageRepository: repository, createImage }) => {
      const imageKey = '3'.repeat(64);
      await createImage({
        imageKey,
        status: CARD_IMAGE_STATUSES.FAILED,
        attemptCount: env.CARD_IMAGE_MAX_ATTEMPTS,
        nextAttemptAt: new Date(Date.now() - env.CARD_IMAGE_RETRY_AFTER_MS),
      });

      const claimed = await repository.claim(imageKey, 'worker');

      expect(claimed).toBeUndefined();
    },
  );

  integrationTest(
    'clears a stale retry time when an image is claimed',
    async ({ db, imageRepository: repository, createImage }) => {
      const imageKey = '4'.repeat(64);
      await createImage({
        imageKey,
        status: CARD_IMAGE_STATUSES.FAILED,
        attemptCount: 1,
        nextAttemptAt: new Date(Date.now() - env.CARD_IMAGE_RETRY_AFTER_MS),
      });

      const claimed = await repository.claim(imageKey, 'worker');
      const [stored] = await db.select().from(cardImage).where(eq(cardImage.imageKey, imageKey));

      expect(claimed?.attemptCount).toBe(2);
      expect(stored?.nextAttemptAt).toBeNull();
    },
  );
});

describe('CardImageRepository.claimBatch', () => {
  integrationTest('never hands the same image to two claimers', async ({ db, imageRepository: repository }) => {
    const imageKeys = Array.from({ length: 10 }, (_, index) => String(index).repeat(64));
    await db.insert(cardImage).values(
      imageKeys.map(imageKey =>
        imageRecord({
          imageKey,
        }),
      ),
    );

    const [first, second] = await Promise.all([
      repository.claimBatch('worker-one', imageKeys.length),
      repository.claimBatch('worker-two', imageKeys.length),
    ]);

    const claimed = [...first, ...second];
    const claimedKeys = claimed.map(row => row.imageKey);

    expect(new Set(claimedKeys).size).toBe(claimedKeys.length);
    expect(claimedKeys).toHaveLength(imageKeys.length);
    expect(claimed.every(row => row.attemptCount === 1)).toBe(true);
    const stored = await db.select().from(cardImage).where(inArray(cardImage.imageKey, claimedKeys));
    expect(stored.every(row => row.status === CARD_IMAGE_STATUSES.FETCHING)).toBe(true);
  });

  integrationTest('claims the oldest due images first', async ({ db, imageRepository: repository }) => {
    const now = Date.now();
    await db.insert(cardImage).values([
      imageRecord({
        imageKey: 'a'.repeat(64),
        createdAt: new Date(now),
      }),
      imageRecord({
        imageKey: 'b'.repeat(64),
        createdAt: new Date(now - 60_000),
      }),
      imageRecord({
        imageKey: 'c'.repeat(64),
        status: CARD_IMAGE_STATUSES.FAILED,
        attemptCount: 1,
        createdAt: new Date(now),
        nextAttemptAt: new Date(now - 30_000),
      }),
    ]);

    const claimed = await repository.claimBatch('worker', 2);

    expect(claimed.map(row => row.imageKey).sort()).toEqual(['b'.repeat(64), 'c'.repeat(64)]);
  });

  integrationTest('leaves exhausted and ready images alone', async ({ db, imageRepository: repository }) => {
    await db.insert(cardImage).values([
      imageRecord({
        imageKey: 'd'.repeat(64),
        status: CARD_IMAGE_STATUSES.READY,
        contentType: 'image/png',
        contentLength: 3,
        checksum: 'checksum',
      }),
      imageRecord({
        imageKey: 'e'.repeat(64),
        status: CARD_IMAGE_STATUSES.FAILED,
        attemptCount: env.CARD_IMAGE_MAX_ATTEMPTS,
        nextAttemptAt: new Date(Date.now() - 60_000),
      }),
    ]);

    const claimed = await repository.claimBatch('worker', 10);

    expect(claimed).toEqual([]);
  });

  integrationTest(
    'returns a claim without consuming an attempt',
    async ({ imageRepository: repository, createImage }) => {
      const imageKey = 'f'.repeat(64);
      await createImage({
        imageKey,
      });

      const [claimed] = await repository.claimBatch('worker', 1);
      const released = await repository.releaseClaim(imageKey, 'worker');
      const afterRelease = await repository.getByImageKey(imageKey);

      expect(claimed?.attemptCount).toBe(1);
      expect(released).toBe(true);
      expect(afterRelease?.attemptCount).toBe(0);
      expect(afterRelease?.status).toBe(CARD_IMAGE_STATUSES.PENDING);
    },
  );
});

describe('CardImageRepository retry backoff', () => {
  integrationTest(
    'waits longer after each failed attempt, up to a cap',
    async ({ db, imageRepository: repository }) => {
      const imageKeys = ['1', '2', '3'].map(prefix => prefix.repeat(63).concat('a'));
      await db.insert(cardImage).values(
        imageKeys.map(imageKey =>
          imageRecord({
            imageKey,
          }),
        ),
      );

      const delays = await Promise.all(
        imageKeys.map(async (imageKey, index) => {
          await repository.claim(imageKey, imageKey);
          const failedAt = Date.now();
          await repository.markFailed(imageKey, imageKey, {
            code: 'origin_http_error',
            message: 'boom',
            isRetryable: true,
            attemptCount: index + 1,
          });
          const row = await repository.getByImageKey(imageKey);

          return (row?.nextAttemptAt?.getTime() ?? 0) - failedAt;
        }),
      );

      const [first, second, third] = delays;

      expect(first).toBeGreaterThanOrEqual(env.CARD_IMAGE_RETRY_AFTER_MS);
      expect(second).toBeGreaterThan(first ?? 0);
      expect(third).toBeGreaterThan(second ?? 0);
      expect(Math.max(...delays)).toBeLessThanOrEqual(env.CARD_IMAGE_MAX_RETRY_AFTER_MS + 1_000);
    },
  );

  integrationTest(
    'stops recovering an expired lease once attempts run out',
    async ({ imageRepository: repository, createImage }) => {
      const imageKey = '5'.repeat(64);
      await createImage({
        imageKey,
        status: CARD_IMAGE_STATUSES.FETCHING,
        attemptCount: env.CARD_IMAGE_MAX_ATTEMPTS,
        leaseOwner: 'dead-instance',
        leaseExpiresAt: new Date(Date.now() - 60_000),
      });

      const claimed = await repository.claim(imageKey, 'worker');
      const batchClaimed = await repository.claimBatch('worker', 10);

      expect(claimed).toBeUndefined();
      expect(batchClaimed).toEqual([]);
    },
  );
});

describe('CardImageRepository.requeueForRefresh', () => {
  integrationTest('sends stored images back through materialization', async ({ db, imageRepository: repository }) => {
    const readyKey = '6'.repeat(64);
    const pendingKey = '7'.repeat(64);
    await db.insert(cardImage).values([
      imageRecord({
        imageKey: readyKey,
        originUrl: 'https://images.example.com/sets/base/art.png',
        storageKey: 'card-images/ready-refresh',
        status: CARD_IMAGE_STATUSES.READY,
        contentType: 'image/png',
        contentLength: 3,
        checksum: 'checksum',
        attemptCount: env.CARD_IMAGE_MAX_ATTEMPTS,
        storedAt: new Date(),
      }),
      imageRecord({
        imageKey: pendingKey,
        originUrl: 'https://images.example.com/sets/base/other.png',
        storageKey: 'card-images/pending-refresh',
      }),
    ]);

    const matched = await repository.findReadyImageKeysByOriginUrlPattern('https://images.example.com/sets/base/%');
    const refreshed = await repository.requeueForRefresh(matched.map(row => row.imageKey));
    const refreshedRow = await repository.getByImageKey(readyKey);
    const claimed = await repository.claimBatch('worker', 10);

    expect(matched.map(row => row.imageKey)).toEqual([readyKey]);
    expect(refreshed).toBe(1);
    expect(refreshedRow?.status).toBe(CARD_IMAGE_STATUSES.PENDING);
    expect(refreshedRow?.attemptCount).toBe(0);
    expect(claimed.map(row => row.imageKey).sort()).toEqual([readyKey, pendingKey].sort());
  });
});
