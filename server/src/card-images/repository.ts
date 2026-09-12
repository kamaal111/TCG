import { and, eq, lt, lte, or, sql } from 'drizzle-orm';

import type { Database } from '../db/index.ts';
import { cardImage } from '../db/schema/card-images.ts';
import env from '../env.ts';

export type CardImageRow = typeof cardImage.$inferSelect;

export class CardImageRepository {
  private readonly db: Database;

  constructor({ db }: { db: Database }) {
    this.db = db;
  }

  static fromContext(c: { get(name: 'db'): Database }): CardImageRepository {
    return new CardImageRepository({ db: c.get('db') });
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
        status: 'fetching',
        leaseOwner,
        leaseExpiresAt: new Date(now.getTime() + env.CARD_IMAGE_LEASE_DURATION_MS),
        lastAttemptedAt: now,
        updatedAt: now,
        attemptCount: sql`${cardImage.attemptCount} + 1`,
      })
      .where(
        and(
          eq(cardImage.imageKey, imageKey),
          or(
            and(
              lt(cardImage.attemptCount, env.CARD_IMAGE_MAX_ATTEMPTS),
              or(
                eq(cardImage.status, 'pending'),
                and(eq(cardImage.status, 'failed'), lte(cardImage.nextAttemptAt, now)),
              ),
            ),
            and(eq(cardImage.status, 'fetching'), lte(cardImage.leaseExpiresAt, now)),
          ),
        ),
      )
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
        status: 'ready',
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
        status: 'failed',
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
      .set({ status: 'pending', storedAt: null, updatedAt: new Date() })
      .where(and(eq(cardImage.imageKey, imageKey), eq(cardImage.status, 'ready')));
  }

  listPending(limit = 100): Promise<CardImageRow[]> {
    const now = new Date();
    return this.db
      .select()
      .from(cardImage)
      .where(
        or(
          and(
            lt(cardImage.attemptCount, env.CARD_IMAGE_MAX_ATTEMPTS),
            or(eq(cardImage.status, 'pending'), and(eq(cardImage.status, 'failed'), lte(cardImage.nextAttemptAt, now))),
          ),
          and(eq(cardImage.status, 'fetching'), lte(cardImage.leaseExpiresAt, now)),
        ),
      )
      .limit(limit);
  }
}
