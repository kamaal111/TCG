import assert from 'node:assert/strict';

import { and, eq, sql } from 'drizzle-orm';

import type { HonoContext } from '../context.ts';
import { PricingLockTimeout } from './exceptions.ts';
import { pricingLogger } from './logging.ts';
import env from '../env.ts';
import type { CardGame, NormalizedPricingCard, PricingSource } from './types.ts';
import { getSession } from '../auth/module.ts';
import { classifyPostgresError } from '../db/errors.ts';
import { cardPrice, cardPriceSearch } from '../db/schema/card-pricing.ts';
import { card } from '../db/schema/cards.ts';
import { isNonEmpty, type NonEmptyArray } from '../utils/type-utils.ts';

export type CardPriceRow = typeof cardPrice.$inferSelect;

type CardPriceSearchRow = typeof cardPriceSearch.$inferSelect;

interface CardPriceUpsertValues {
  game: CardGame;
  card: NormalizedPricingCard;
  raw: unknown;
  pricedOn: string;
  pricingSource: PricingSource;
}

interface PricingLock {
  game: CardGame;
  key: string;
  keyType: 'card' | 'search';
  pricedOn: string;
}

export class CardPricingRepository {
  private readonly c: HonoContext;

  constructor(c: HonoContext) {
    this.c = c;
  }

  private get db() {
    return this.c.get('db');
  }

  private get userId() {
    return getSession(this.c).user.id;
  }

  /**
   * Runs an operation inside a Postgres advisory transaction lock keyed to the given pricing key.
   *
   * @param lock Lock identity and metadata used for logging.
   * @param operation Work to run once the lock is held.
   * @returns The operation's result.
   */
  async withPricingLock<T>(lock: PricingLock, operation: () => Promise<T>): Promise<T> {
    let lockStartedAt: number | undefined;
    let lockWaitMs = 0;
    let acquired = false;

    try {
      const result = await this.db.transaction(async transaction => {
        await transaction.execute(sql`select set_config('lock_timeout', ${`${env.PRICING_LOCK_TIMEOUT_MS}ms`}, true)`);
        lockStartedAt = performance.now();
        await transaction.execute(sql`select pg_advisory_xact_lock(hashtextextended(${lock.key}, 0))`);
        lockWaitMs = Math.round(performance.now() - lockStartedAt);
        acquired = true;
        await transaction.execute(sql`select set_config('lock_timeout', '0', true)`);
        return operation();
      });
      this.logLock(lock, 'acquired', lockWaitMs, 'success');
      return result;
    } catch (error) {
      if (!acquired) lockWaitMs = lockStartedAt == null ? 0 : Math.round(performance.now() - lockStartedAt);
      const timedOut = classifyPostgresError(error) === 'lock_not_available';
      this.logLock(lock, timedOut ? 'timeout' : acquired ? 'acquired' : 'failed', lockWaitMs, 'failure');
      if (timedOut) throw new PricingLockTimeout(this.c);
      throw error;
    }
  }

  /**
   * Gets the cached price for a card by its provider identity and pricing date.
   *
   * @param game Card game the price belongs to.
   * @param pricingSource Provider and client mode that produced the identifier.
   * @param pricingCardId Provider card identifier.
   * @param pricedOn Pricing date the cache entry applies to.
   * @returns The cached price row, or undefined when absent.
   */
  getCachedCardPrice(
    pricingSource: PricingSource,
    game: CardGame,
    pricingCardId: string,
    pricedOn: string,
  ): Promise<CardPriceRow | undefined> {
    return this.db.query.cardPrice.findFirst({ where: { pricingSource, game, pricingCardId, pricedOn } });
  }

  /**
   * Gets the cached price for a card by its internal price row id and pricing date.
   *
   * @param pricingSource Provider and client mode that produced the row.
   * @param game Card game the price belongs to.
   * @param id Card price row identifier.
   * @param pricedOn Pricing date the cache entry applies to.
   * @returns The cached price row, or undefined when absent.
   */
  getCachedCardPriceById(
    pricingSource: PricingSource,
    game: CardGame,
    id: string,
    pricedOn: string,
  ): Promise<CardPriceRow | undefined> {
    return this.db.query.cardPrice.findFirst({ where: { id, pricingSource, game, pricedOn } });
  }

  /**
   * Gets cached prices for provider card identifiers and a pricing date.
   *
   * @param game Card game the prices belong to.
   * @param pricingSource Provider and client mode that produced the identifiers.
   * @param pricingCardIds Provider card identifiers to look up.
   * @param pricedOn Pricing date the cache entries apply to.
   * @returns The cached price rows found, empty when `pricingCardIds` is empty.
   */
  getCachedCardPrices(
    pricingSource: PricingSource,
    game: CardGame,
    pricingCardIds: string[],
    pricedOn: string,
  ): Promise<CardPriceRow[]> {
    if (pricingCardIds.length === 0) return Promise.resolve([]);

    return this.db.query.cardPrice.findMany({
      where: { pricingSource, game, pricedOn, pricingCardId: { in: pricingCardIds } },
    });
  }

  /**
   * Inserts or refreshes the cached price for a single card.
   *
   * @param values Card, pricing, and source data to persist.
   * @returns The upserted price row.
   */
  async upsertCardPrice(values: CardPriceUpsertValues): Promise<CardPriceRow> {
    const [row] = await this.upsertCardPrices([values]);

    return row;
  }

  /**
   * Inserts or refreshes the cached prices for a batch of cards.
   *
   * @param values Card, pricing, and source data to persist for each card.
   * @returns The upserted price rows.
   */
  async upsertCardPrices(values: NonEmptyArray<CardPriceUpsertValues>): Promise<NonEmptyArray<CardPriceRow>> {
    const rows = await this.db
      .insert(cardPrice)
      .values(
        values.map(value => ({
          game: value.game,
          pricingCardId: value.card.id,
          cardNumber: value.card.cardNumber,
          name: value.card.name,
          pricedOn: value.pricedOn,
          prices: value.card.pricing,
          raw: value.raw,
          pricingSource: value.pricingSource,
        })),
      )
      .onConflictDoUpdate({
        target: [cardPrice.pricingSource, cardPrice.game, cardPrice.pricingCardId, cardPrice.pricedOn],
        set: {
          cardNumber: sql`excluded.card_number`,
          name: sql`excluded.name`,
          prices: sql`excluded.prices`,
          raw: sql`excluded.raw`,
          pricingSource: sql`excluded.pricing_source`,
          fetchedAt: new Date(),
        },
      })
      .returning();
    assert(isNonEmpty(rows), 'Card price upsert did not return any rows');

    return rows;
  }

  /**
   * Gets the cached search result for a normalized query and pricing date.
   *
   * @param pricingSource Provider and client mode that owns the cached search.
   * @param game Card game the search belongs to.
   * @param normalizedQueryKey Normalized search query key.
   * @param pricedOn Pricing date the cache entry applies to.
   * @returns The cached search row, or undefined when absent.
   */
  getCachedSearch(
    pricingSource: PricingSource,
    game: CardGame,
    normalizedQueryKey: string,
    pricedOn: string,
  ): Promise<CardPriceSearchRow | undefined> {
    return this.db.query.cardPriceSearch.findFirst({
      where: { pricingSource, game, queryKey: normalizedQueryKey, pricedOn },
    });
  }

  /**
   * Inserts or refreshes cached provider card identifiers for a search query.
   *
   * @param values Source, game, query key, pricing date, and matching provider identifiers.
   */
  async upsertSearch(values: {
    pricingSource: PricingSource;
    game: CardGame;
    queryKey: string;
    pricedOn: string;
    pricingCardIds: string[];
  }): Promise<void> {
    await this.db
      .insert(cardPriceSearch)
      .values(values)
      .onConflictDoUpdate({
        target: [
          cardPriceSearch.pricingSource,
          cardPriceSearch.game,
          cardPriceSearch.queryKey,
          cardPriceSearch.pricedOn,
        ],
        set: { pricingCardIds: values.pricingCardIds, fetchedAt: new Date() },
      });
  }

  /**
   * Links an owned card to its resolved provider identity when owned by the current session user.
   *
   * @param ownedCardId Owned card identifier.
   * @param pricingCardId Provider card identifier to link.
   * @param pricingSource Provider and client mode that owns the identifier.
   */
  async setOwnedCardPricingIdentity(
    ownedCardId: string,
    pricingCardId: string,
    pricingSource: PricingSource,
  ): Promise<void> {
    await this.db
      .update(card)
      .set({ pricingCardId, pricingSource })
      .where(and(eq(card.id, ownedCardId), eq(card.userId, this.userId)));
  }

  private logLock(
    lock: PricingLock,
    lockStatus: 'acquired' | 'failed' | 'timeout',
    lockWaitMs: number,
    outcome: 'failure' | 'success',
  ) {
    const fields = {
      event: 'pricing.lock.completed',
      game: lock.game,
      lock_key_type: lock.keyType,
      lock_status: lockStatus,
      lock_wait_ms: lockWaitMs,
      priced_on: lock.pricedOn,
    } as const;
    const logger = pricingLogger(this.c);
    if (outcome === 'success') {
      logger.info({ ...fields, outcome }, 'Completed a card pricing lock operation.');

      return;
    }

    logger.warn(
      { ...fields, outcome, error_code: 'PRICING_LOCK_UNAVAILABLE' },
      'Completed a card pricing lock operation.',
    );
  }
}
