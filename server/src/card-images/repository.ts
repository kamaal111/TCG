import { and, asc, eq, inArray, lt, lte, or, sql } from 'drizzle-orm';

import type { HonoContext } from '../context.ts';
import { CARD_IMAGE_STATUSES, cardImage } from '../db/schema/card-images.ts';
import env from '../env.ts';

export type CardImageRow = typeof cardImage.$inferSelect;

export type ClaimedCardImageRow = Pick<CardImageRow, 'imageKey' | 'originUrl' | 'storageKey' | 'attemptCount'>;

function claimableCondition(now: Date) {
  return and(
    lt(cardImage.attemptCount, env.CARD_IMAGE_MAX_ATTEMPTS),
    or(
      eq(cardImage.status, CARD_IMAGE_STATUSES.PENDING),
      and(eq(cardImage.status, CARD_IMAGE_STATUSES.FAILED), lte(cardImage.nextAttemptAt, now)),
      and(eq(cardImage.status, CARD_IMAGE_STATUSES.FETCHING), lte(cardImage.leaseExpiresAt, now)),
    ),
  );
}

function nextAttemptDelayMs(attemptCount: number): number {
  const exponential = env.CARD_IMAGE_RETRY_AFTER_MS * 2 ** Math.max(attemptCount - 1, 0);

  return Math.min(exponential, env.CARD_IMAGE_MAX_RETRY_AFTER_MS);
}

function claimOrder() {
  return sql`coalesce(${cardImage.nextAttemptAt}, ${cardImage.createdAt})`;
}

function claimValues(leaseOwner: string, now: Date) {
  return {
    status: CARD_IMAGE_STATUSES.FETCHING,
    leaseOwner,
    leaseExpiresAt: new Date(now.getTime() + env.CARD_IMAGE_LEASE_DURATION_MS),
    lastAttemptedAt: now,
    nextAttemptAt: null,
    updatedAt: now,
    attemptCount: sql`${cardImage.attemptCount} + 1`,
  };
}

export class CardImageRepository {
  private readonly c: HonoContext;

  constructor(c: HonoContext) {
    this.c = c;
  }

  private get db() {
    return this.c.get('db');
  }

  getByImageKey(imageKey: string): Promise<CardImageRow | undefined> {
    return this.db.query.cardImage.findFirst({ where: { imageKey } });
  }

  async registerMany(values: { imageKey: string; originUrl: string; storageKey: string }[]): Promise<CardImageRow[]> {
    if (values.length === 0) {
      return [];
    }

    return this.db.insert(cardImage).values(values).onConflictDoNothing({ target: cardImage.imageKey }).returning();
  }

  async claim(imageKey: string, leaseOwner: string, now = new Date()): Promise<CardImageRow | undefined> {
    const [claimed] = await this.db
      .update(cardImage)
      .set(claimValues(leaseOwner, now))
      .where(and(eq(cardImage.imageKey, imageKey), claimableCondition(now)))
      .returning();

    return claimed;
  }

  /**
   * The subquery takes the row locks and the UPDATE acts on exactly those locked rows under a
   * single snapshot, so `claimableCondition` is deliberately NOT repeated in the outer WHERE.
   * `SKIP LOCKED` is what lets several instances partition the queue instead of racing for the
   * same rows; it is only legal here because the subquery reads one table with no join or
   * grouping. Note `LIMIT` applies before rows locked elsewhere are skipped, so a short batch
   * means "nothing more for me right now", not "the queue is empty".
   */
  async claimBatch(leaseOwner: string, limit: number, now = new Date()): Promise<ClaimedCardImageRow[]> {
    if (limit <= 0) {
      return [];
    }

    const claimable = this.db
      .select({ imageKey: cardImage.imageKey })
      .from(cardImage)
      .where(claimableCondition(now))
      .orderBy(asc(claimOrder()), asc(cardImage.imageKey))
      .limit(limit)
      .for('update', { skipLocked: true });

    return this.db
      .update(cardImage)
      .set(claimValues(leaseOwner, now))
      .where(inArray(cardImage.imageKey, claimable))
      .returning({
        imageKey: cardImage.imageKey,
        originUrl: cardImage.originUrl,
        storageKey: cardImage.storageKey,
        attemptCount: cardImage.attemptCount,
      });
  }

  /**
   * Hands a claim back without consuming an attempt, for when the claimer discovers the work is
   * already in flight elsewhere in this process. Returning to `pending` rather than the previous
   * status is a deliberate simplification: at worst a previously failed row skips one retry delay.
   */
  async releaseClaim(imageKey: string, leaseOwner: string): Promise<boolean> {
    const rows = await this.db
      .update(cardImage)
      .set({
        status: CARD_IMAGE_STATUSES.PENDING,
        leaseOwner: null,
        leaseExpiresAt: null,
        attemptCount: sql`greatest(${cardImage.attemptCount} - 1, 0)`,
      })
      .where(and(eq(cardImage.imageKey, imageKey), eq(cardImage.leaseOwner, leaseOwner)))
      .returning({ imageKey: cardImage.imageKey });

    return rows.length === 1;
  }

  async markReady(
    imageKey: string,
    leaseOwner: string,
    values: { contentType: string; contentLength: number; checksum: string },
  ): Promise<boolean> {
    const rows = await this.db
      .update(cardImage)
      .set({
        ...values,
        status: CARD_IMAGE_STATUSES.READY,
        attemptCount: 0,
        lastError: null,
        lastErrorCode: null,
        nextAttemptAt: null,
        leaseOwner: null,
        leaseExpiresAt: null,
        storedAt: new Date(),
      })
      .where(and(eq(cardImage.imageKey, imageKey), eq(cardImage.leaseOwner, leaseOwner)))
      .returning({ imageKey: cardImage.imageKey });

    return rows.length === 1;
  }

  async markFailed(
    imageKey: string,
    leaseOwner: string,
    failure: { code: string; message: string; isRetryable: boolean; attemptCount: number },
  ): Promise<boolean> {
    const now = new Date();
    const nextAttemptAt = failure.isRetryable
      ? new Date(now.getTime() + nextAttemptDelayMs(failure.attemptCount))
      : null;
    const rows = await this.db
      .update(cardImage)
      .set({
        status: CARD_IMAGE_STATUSES.FAILED,
        lastError: failure.message,
        lastErrorCode: failure.code,
        nextAttemptAt,
        leaseOwner: null,
        leaseExpiresAt: null,
        updatedAt: now,
      })
      .where(and(eq(cardImage.imageKey, imageKey), eq(cardImage.leaseOwner, leaseOwner)))
      .returning({ imageKey: cardImage.imageKey });

    return rows.length === 1;
  }

  async findReadyImageKeysByOriginUrlPattern(pattern: string): Promise<Pick<CardImageRow, 'imageKey'>[]> {
    return this.db.query.cardImage.findMany({
      columns: { imageKey: true },
      where: {
        status: CARD_IMAGE_STATUSES.READY,
        RAW: (cardImage, { like }) => like(cardImage.originUrl, pattern),
      },
      limit: env.CARD_IMAGE_ORIGIN_URL_PATTERN_LIMIT,
    });
  }

  /**
   * Sends stored images back through materialization, for when the bytes we hold are wrong rather
   * than stale — an origin placeholder that was cached as art, or a change to how we store images.
   * Nothing else ever re-fetches a `ready` row.
   */
  async requeueForRefresh(imageKeys: string[]): Promise<number> {
    if (imageKeys.length === 0) {
      return 0;
    }

    const rows = await this.db
      .update(cardImage)
      .set({
        status: CARD_IMAGE_STATUSES.PENDING,
        attemptCount: 0,
        lastError: null,
        lastErrorCode: null,
        nextAttemptAt: null,
        leaseOwner: null,
        leaseExpiresAt: null,
        storedAt: null,
      })
      .where(and(inArray(cardImage.imageKey, imageKeys), eq(cardImage.status, CARD_IMAGE_STATUSES.READY)))
      .returning({ imageKey: cardImage.imageKey });

    return rows.length;
  }

  async resetMissingObject(imageKey: string): Promise<void> {
    await this.db
      .update(cardImage)
      .set({
        status: CARD_IMAGE_STATUSES.PENDING,
        attemptCount: 0,
        lastError: null,
        lastErrorCode: null,
        nextAttemptAt: null,
        storedAt: null,
      })
      .where(and(eq(cardImage.imageKey, imageKey), eq(cardImage.status, CARD_IMAGE_STATUSES.READY)));
  }
}
