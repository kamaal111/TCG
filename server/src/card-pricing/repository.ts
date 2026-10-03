import assert from 'node:assert/strict';

import { and, eq, sql } from 'drizzle-orm';
import type { ResultAsync } from 'neverthrow';

import type { HonoContext } from '../context.ts';
import {
  CARD_PRICING_EXCEPTION_CODES,
  PricingLockTimeout,
  PricingLockUnavailable,
  PricingProviderUnavailable,
  PricingOperationFailed,
  type PricingLockError,
} from './exceptions.ts';
import { pricingLogger } from './logging.ts';
import env from '../env.ts';
import type { CardGame, NormalizedPricingCard, PricingSource } from './types.ts';
import { getSession } from '../auth/module.ts';
import { classifyPostgresError } from '../db/errors.ts';
import { cardPrice, cardPriceSearch } from '../db/schema/card-pricing.ts';
import { card } from '../db/schema/cards.ts';
import { toError, tryCatch } from '../utils/results.ts';
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
   * @returns Ok with the operation's value, or Err containing an APIException subclass for the classified lock or operation failure.
   */
  withPricingLock<T>(lock: PricingLock, operation: () => Promise<T>): ResultAsync<T, PricingLockError> {
    let lockStartedAt: number | undefined = undefined;
    let lockWaitMs = 0;
    let acquired = false;

    return tryCatch(async () =>
      this.db.transaction(async transaction => {
        await transaction.execute(sql`select set_config('lock_timeout', ${`${env.PRICING_LOCK_TIMEOUT_MS}ms`}, true)`);
        lockStartedAt = performance.now();
        await transaction.execute(sql`select pg_advisory_xact_lock(hashtextextended(${lock.key}, 0))`);
        lockWaitMs = Math.round(performance.now() - lockStartedAt);
        acquired = true;
        await transaction.execute(sql`select set_config('lock_timeout', '0', true)`);

        return operation();
      }),
    )
      .map(value => {
        this.logLock({ lock, lockStatus: 'acquired', lockWaitMs, outcome: 'success' });

        return value;
      })
      .mapErr((error): PricingLockError => {
        if (!acquired) {
          lockWaitMs = lockStartedAt == null ? 0 : Math.round(performance.now() - lockStartedAt);
        }

        const cause = toError(error);
        const timedOut = !acquired && classifyPostgresError(cause) === 'lock_not_available';

        let failure: PricingLockError;
        let errorCode: string;
        let lockStatus: 'acquired' | 'failed' | 'timeout';

        if (timedOut) {
          failure = new PricingLockTimeout(this.c, cause);
          errorCode = CARD_PRICING_EXCEPTION_CODES.PRICING_LOCK_TIMEOUT;
          lockStatus = 'timeout';
        } else if (!acquired) {
          failure = new PricingLockUnavailable(this.c, cause);
          errorCode = CARD_PRICING_EXCEPTION_CODES.PRICING_PROVIDER_UNAVAILABLE;
          lockStatus = 'failed';
        } else if (cause instanceof PricingProviderUnavailable) {
          failure = cause;
          errorCode = CARD_PRICING_EXCEPTION_CODES.PRICING_PROVIDER_UNAVAILABLE;
          lockStatus = 'acquired';
        } else {
          failure = new PricingOperationFailed(this.c, cause);
          errorCode = 'PRICING_OPERATION_FAILED';
          lockStatus = 'acquired';
        }

        this.logLock({
          lock,
          lockStatus,
          lockWaitMs,
          outcome: 'failure',
          errorCode,
          failure,
        });

        return failure;
      });
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
    if (pricingCardIds.length === 0) {
      return Promise.resolve([]);
    }

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

  private logLock({
    lock,
    lockStatus,
    lockWaitMs,
    outcome,
    errorCode,
    failure,
  }: {
    lock: PricingLock;
    lockStatus: 'acquired' | 'failed' | 'timeout';
    lockWaitMs: number;
  } & (
    | { outcome: 'success'; errorCode?: never; failure?: never }
    | { outcome: 'failure'; errorCode: string; failure: PricingLockError }
  )) {
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

    if (failure instanceof PricingOperationFailed || failure instanceof PricingLockUnavailable) {
      logger.error(
        { ...fields, outcome, error_code: errorCode, err: failure },
        'Failed a card pricing lock operation unexpectedly.',
      );

      return;
    }

    logger.warn({ ...fields, outcome, error_code: errorCode }, 'Completed a card pricing lock operation.');
  }
}
