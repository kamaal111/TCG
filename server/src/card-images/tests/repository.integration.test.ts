import { eq } from 'drizzle-orm';

import { createDatabaseOnlyContext } from '../../context.ts';
import { CARD_IMAGE_STATUSES, cardImage } from '../../db/schema/card-images.ts';
import env from '../../env.ts';
import { integrationTest } from '../../tests/fixtures.ts';
import { CardImageRepository } from '../repository.ts';

describe('CardImageRepository attempt accounting', () => {
  integrationTest('clears the attempt count once an image is ready', async ({ db }) => {
    const imageKey = '1'.repeat(64);
    const repository = new CardImageRepository(createDatabaseOnlyContext(db));
    await db.insert(cardImage).values({
      imageKey,
      originUrl: 'https://images.example.com/ready.png',
      storageKey: 'card-images/ready',
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
  });

  integrationTest('makes an image claimable again after its stored object disappears', async ({ db }) => {
    const imageKey = '2'.repeat(64);
    const repository = new CardImageRepository(createDatabaseOnlyContext(db));
    await db.insert(cardImage).values({
      imageKey,
      originUrl: 'https://images.example.com/vanished.png',
      storageKey: 'card-images/vanished',
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
  });

  integrationTest('stops claiming an image that exhausted its attempts', async ({ db }) => {
    const imageKey = '3'.repeat(64);
    const repository = new CardImageRepository(createDatabaseOnlyContext(db));
    await db.insert(cardImage).values({
      imageKey,
      originUrl: 'https://images.example.com/exhausted.png',
      storageKey: 'card-images/exhausted',
      status: CARD_IMAGE_STATUSES.FAILED,
      attemptCount: env.CARD_IMAGE_MAX_ATTEMPTS,
      nextAttemptAt: new Date(Date.now() - env.CARD_IMAGE_RETRY_AFTER_MS),
    });

    const claimed = await repository.claim(imageKey, 'worker');

    expect(claimed).toBeUndefined();
  });

  integrationTest('clears a stale retry time when an image is claimed', async ({ db }) => {
    const imageKey = '4'.repeat(64);
    const repository = new CardImageRepository(createDatabaseOnlyContext(db));
    await db.insert(cardImage).values({
      imageKey,
      originUrl: 'https://images.example.com/retry.png',
      storageKey: 'card-images/retry',
      status: CARD_IMAGE_STATUSES.FAILED,
      attemptCount: 1,
      nextAttemptAt: new Date(Date.now() - env.CARD_IMAGE_RETRY_AFTER_MS),
    });

    const claimed = await repository.claim(imageKey, 'worker');
    const [stored] = await db.select().from(cardImage).where(eq(cardImage.imageKey, imageKey));

    expect(claimed?.attemptCount).toBe(2);
    expect(stored?.nextAttemptAt).toBeNull();
  });
});

describe('CardImageRepository.claimBatch', () => {
  integrationTest('never hands the same image to two claimers', async ({ db }) => {
    const repository = new CardImageRepository(createDatabaseOnlyContext(db));
    const imageKeys = Array.from({ length: 10 }, (_, index) => String(index).repeat(64));
    await db.insert(cardImage).values(
      imageKeys.map(imageKey => ({
        imageKey,
        originUrl: `https://images.example.com/${imageKey}.png`,
        storageKey: `card-images/${imageKey}`,
      })),
    );

    const [first, second] = await Promise.all([
      repository.claimBatch('worker-one', imageKeys.length),
      repository.claimBatch('worker-two', imageKeys.length),
    ]);

    const claimed = [...first, ...second];
    const claimedKeys = claimed.map(row => row.imageKey);

    expect(new Set(claimedKeys).size).toBe(claimedKeys.length);
    expect(claimedKeys).toHaveLength(imageKeys.length);
    expect(claimed.every(row => row.status === CARD_IMAGE_STATUSES.FETCHING)).toBe(true);
    expect(claimed.every(row => row.attemptCount === 1)).toBe(true);
  });

  integrationTest('claims the oldest due images first', async ({ db }) => {
    const repository = new CardImageRepository(createDatabaseOnlyContext(db));
    const now = Date.now();
    await db.insert(cardImage).values([
      {
        imageKey: 'a'.repeat(64),
        originUrl: 'https://images.example.com/newest.png',
        storageKey: 'card-images/newest',
        createdAt: new Date(now),
      },
      {
        imageKey: 'b'.repeat(64),
        originUrl: 'https://images.example.com/oldest.png',
        storageKey: 'card-images/oldest',
        createdAt: new Date(now - 60_000),
      },
      {
        imageKey: 'c'.repeat(64),
        originUrl: 'https://images.example.com/due.png',
        storageKey: 'card-images/due',
        status: CARD_IMAGE_STATUSES.FAILED,
        attemptCount: 1,
        createdAt: new Date(now),
        nextAttemptAt: new Date(now - 30_000),
      },
    ]);

    const claimed = await repository.claimBatch('worker', 2);

    // RETURNING has no defined order; the guarantee is which rows the batch selects.
    expect(claimed.map(row => row.imageKey).sort()).toEqual(['b'.repeat(64), 'c'.repeat(64)]);
  });

  integrationTest('leaves exhausted and ready images alone', async ({ db }) => {
    const repository = new CardImageRepository(createDatabaseOnlyContext(db));
    await db.insert(cardImage).values([
      {
        imageKey: 'd'.repeat(64),
        originUrl: 'https://images.example.com/done.png',
        storageKey: 'card-images/done',
        status: CARD_IMAGE_STATUSES.READY,
        contentType: 'image/png',
        contentLength: 3,
        checksum: 'checksum',
      },
      {
        imageKey: 'e'.repeat(64),
        originUrl: 'https://images.example.com/spent.png',
        storageKey: 'card-images/spent',
        status: CARD_IMAGE_STATUSES.FAILED,
        attemptCount: env.CARD_IMAGE_MAX_ATTEMPTS,
        nextAttemptAt: new Date(Date.now() - 60_000),
      },
    ]);

    const claimed = await repository.claimBatch('worker', 10);

    expect(claimed).toEqual([]);
  });

  integrationTest('returns a claim without consuming an attempt', async ({ db }) => {
    const imageKey = 'f'.repeat(64);
    const repository = new CardImageRepository(createDatabaseOnlyContext(db));
    await db.insert(cardImage).values({
      imageKey,
      originUrl: 'https://images.example.com/released.png',
      storageKey: 'card-images/released',
    });

    const [claimed] = await repository.claimBatch('worker', 1);
    const released = await repository.releaseClaim(imageKey, 'worker');
    const afterRelease = await repository.getByImageKey(imageKey);

    expect(claimed?.attemptCount).toBe(1);
    expect(released).toBe(true);
    expect(afterRelease?.attemptCount).toBe(0);
    expect(afterRelease?.status).toBe(CARD_IMAGE_STATUSES.PENDING);
  });
});

describe('CardImageRepository retry backoff', () => {
  integrationTest('waits longer after each failed attempt, up to a cap', async ({ db }) => {
    const repository = new CardImageRepository(createDatabaseOnlyContext(db));
    const imageKeys = ['1', '2', '3'].map(prefix => prefix.repeat(63).concat('a'));
    await db.insert(cardImage).values(
      imageKeys.map(imageKey => ({
        imageKey,
        originUrl: `https://images.example.com/${imageKey}.png`,
        storageKey: `card-images/${imageKey}`,
      })),
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
  });

  integrationTest('stops recovering an expired lease once attempts run out', async ({ db }) => {
    const imageKey = '5'.repeat(64);
    const repository = new CardImageRepository(createDatabaseOnlyContext(db));
    await db.insert(cardImage).values({
      imageKey,
      originUrl: 'https://images.example.com/stuck.png',
      storageKey: 'card-images/stuck',
      status: CARD_IMAGE_STATUSES.FETCHING,
      attemptCount: env.CARD_IMAGE_MAX_ATTEMPTS,
      leaseOwner: 'dead-instance',
      leaseExpiresAt: new Date(Date.now() - 60_000),
    });

    const claimed = await repository.claim(imageKey, 'worker');
    const batchClaimed = await repository.claimBatch('worker', 10);

    expect(claimed).toBeUndefined();
    expect(batchClaimed).toEqual([]);
  });
});

describe('CardImageRepository.requeueForRefresh', () => {
  integrationTest('sends stored images back through materialization', async ({ db }) => {
    const repository = new CardImageRepository(createDatabaseOnlyContext(db));
    const readyKey = '6'.repeat(64);
    const pendingKey = '7'.repeat(64);
    await db.insert(cardImage).values([
      {
        imageKey: readyKey,
        originUrl: 'https://images.example.com/sets/base/art.png',
        storageKey: 'card-images/ready-refresh',
        status: CARD_IMAGE_STATUSES.READY,
        contentType: 'image/png',
        contentLength: 3,
        checksum: 'checksum',
        attemptCount: env.CARD_IMAGE_MAX_ATTEMPTS,
        storedAt: new Date(),
      },
      {
        imageKey: pendingKey,
        originUrl: 'https://images.example.com/sets/base/other.png',
        storageKey: 'card-images/pending-refresh',
      },
    ]);

    const matched = await repository.findReadyByOriginUrlPattern('https://images.example.com/sets/base/%');
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
