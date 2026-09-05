import { and, eq, lt, lte, or, sql } from 'drizzle-orm';

import type { HonoContext } from '../context.ts';
import { CARD_IMAGE_STATUSES, cardImage } from '../db/schema/card-images.ts';
import env from '../env.ts';

export type CardImageRow = typeof cardImage.$inferSelect;

function claimableCondition(now: Date) {
  return or(
    and(
      lt(cardImage.attemptCount, env.CARD_IMAGE_MAX_ATTEMPTS),
      or(
        eq(cardImage.status, CARD_IMAGE_STATUSES.PENDING),
        and(eq(cardImage.status, CARD_IMAGE_STATUSES.FAILED), lte(cardImage.nextAttemptAt, now)),
      ),
    ),
    and(eq(cardImage.status, CARD_IMAGE_STATUSES.FETCHING), lte(cardImage.leaseExpiresAt, now)),
  );
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
    if (values.length === 0) return [];
    return this.db.insert(cardImage).values(values).onConflictDoNothing({ target: cardImage.imageKey }).returning();
  }

  async claim(imageKey: string, leaseOwner: string, now = new Date()): Promise<CardImageRow | undefined> {
    const [claimed] = await this.db
      .update(cardImage)
      .set({
        status: CARD_IMAGE_STATUSES.FETCHING,
        leaseOwner,
        leaseExpiresAt: new Date(now.getTime() + env.CARD_IMAGE_LEASE_DURATION_MS),
        lastAttemptedAt: now,
        updatedAt: now,
        attemptCount: sql`${cardImage.attemptCount} + 1`,
      })
      .where(and(eq(cardImage.imageKey, imageKey), claimableCondition(now)))
      .returning();
    return claimed;
  }

  async markReady(
    imageKey: string,
    leaseOwner: string,
    values: { contentType: string; contentLength: number; checksum: string },
  ): Promise<boolean> {
    const rows = await this.db
      .update(cardImage)
      .set({
        status: CARD_IMAGE_STATUSES.READY,
        ...values,
        lastError: null,
        lastErrorCode: null,
        nextAttemptAt: null,
        leaseOwner: null,
        leaseExpiresAt: null,
        storedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(and(eq(cardImage.imageKey, imageKey), eq(cardImage.leaseOwner, leaseOwner)))
      .returning({ imageKey: cardImage.imageKey });
    return rows.length === 1;
  }

  async markFailed(
    imageKey: string,
    leaseOwner: string,
    failure: { code: string; message: string; isRetryable: boolean },
  ): Promise<boolean> {
    const now = new Date();
    const rows = await this.db
      .update(cardImage)
      .set({
        status: CARD_IMAGE_STATUSES.FAILED,
        lastError: failure.message,
        lastErrorCode: failure.code,
        nextAttemptAt: failure.isRetryable ? new Date(now.getTime() + env.CARD_IMAGE_RETRY_AFTER_MS) : null,
        leaseOwner: null,
        leaseExpiresAt: null,
        updatedAt: now,
      })
      .where(and(eq(cardImage.imageKey, imageKey), eq(cardImage.leaseOwner, leaseOwner)))
      .returning({ imageKey: cardImage.imageKey });
    return rows.length === 1;
  }

  async resetMissingObject(imageKey: string): Promise<void> {
    await this.db
      .update(cardImage)
      .set({ status: CARD_IMAGE_STATUSES.PENDING, storedAt: null, updatedAt: new Date() })
      .where(and(eq(cardImage.imageKey, imageKey), eq(cardImage.status, CARD_IMAGE_STATUSES.READY)));
  }

  listPending(limit = 100): Promise<CardImageRow[]> {
    return this.db.select().from(cardImage).where(claimableCondition(new Date())).limit(limit);
  }
}
