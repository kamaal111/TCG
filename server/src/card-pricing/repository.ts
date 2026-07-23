import { and, eq, inArray, sql } from 'drizzle-orm';

import { getSessionWhereSessionIsRequired } from '../auth/utils/session.ts';
import type { CardWithQuantities } from '../cards/repository.ts';
import type { HonoContext } from '../context.ts';
import type { Database } from '../db/index.ts';
import { card } from '../db/schema/cards.ts';
import { cardPrice, cardPriceSearch } from '../db/schema/card-pricing.ts';
import env from '../env.ts';
import { withRequestLogger } from '../logging/http.ts';
import { logInfo, logWarn } from '../logging/index.ts';
import { PricingLockTimeout } from './exceptions.ts';
import type { CardGame, NormalizedTCGGOCard, TCGGORawCard } from './tcggo/types.ts';

export type CardPriceRow = typeof cardPrice.$inferSelect;
export type CardPriceSearchRow = typeof cardPriceSearch.$inferSelect;
type DatabaseTransaction = Parameters<Parameters<Database['transaction']>[0]>[0];
export type PricingDatabase = Database | DatabaseTransaction;

interface PricingLock {
  game: CardGame;
  key: string;
  keyType: 'card' | 'search';
  pricedOn: string;
}

export class CardPricingRepository {
  static async withPricingLock<T>(
    c: HonoContext,
    lock: PricingLock,
    operation: (transaction: DatabaseTransaction) => Promise<T>,
  ): Promise<T> {
    let lockStartedAt: number | undefined;
    let lockWaitMs = 0;
    let acquired = false;

    try {
      const result = await c.get('db').transaction(async transaction => {
        await transaction.execute(sql`select set_config('lock_timeout', ${`${env.PRICING_LOCK_TIMEOUT_MS}ms`}, true)`);
        lockStartedAt = performance.now();
        await transaction.execute(sql`select pg_advisory_xact_lock(hashtextextended(${lock.key}, 0))`);
        lockWaitMs = Math.round(performance.now() - lockStartedAt);
        acquired = true;
        await transaction.execute(sql`select set_config('lock_timeout', '0', true)`);
        return operation(transaction);
      });
      this.logLock(c, lock, 'acquired', lockWaitMs, 'success');
      return result;
    } catch (error) {
      if (!acquired) lockWaitMs = lockStartedAt == null ? 0 : Math.round(performance.now() - lockStartedAt);
      const timedOut = postgresErrorCode(error) === '55P03';
      this.logLock(c, lock, timedOut ? 'timeout' : acquired ? 'acquired' : 'failed', lockWaitMs, 'failure');
      if (timedOut) throw new PricingLockTimeout(c);
      throw error;
    }
  }

  static getCachedCardPrice(
    c: HonoContext,
    game: CardGame,
    tcggoCardId: string,
    pricedOn: string,
    database: PricingDatabase = c.get('db'),
  ): Promise<CardPriceRow | undefined> {
    return database
      .select()
      .from(cardPrice)
      .where(and(eq(cardPrice.game, game), eq(cardPrice.tcggoCardId, tcggoCardId), eq(cardPrice.pricedOn, pricedOn)))
      .limit(1)
      .then(rows => rows[0]);
  }

  static getCachedCardPrices(
    c: HonoContext,
    game: CardGame,
    tcggoCardIds: string[],
    pricedOn: string,
    database: PricingDatabase = c.get('db'),
  ): Promise<CardPriceRow[]> {
    if (tcggoCardIds.length === 0) return Promise.resolve([]);

    return database
      .select()
      .from(cardPrice)
      .where(
        and(eq(cardPrice.game, game), eq(cardPrice.pricedOn, pricedOn), inArray(cardPrice.tcggoCardId, tcggoCardIds)),
      );
  }

  static async upsertCardPrice(
    c: HonoContext,
    values: {
      game: CardGame;
      card: NormalizedTCGGOCard;
      raw: TCGGORawCard;
      pricedOn: string;
      source: 'static' | 'real';
    },
    database: PricingDatabase = c.get('db'),
  ): Promise<CardPriceRow> {
    const [row] = await database
      .insert(cardPrice)
      .values({
        game: values.game,
        tcggoCardId: values.card.id,
        cardNumber: values.card.cardNumber,
        name: values.card.name,
        pricedOn: values.pricedOn,
        prices: values.card.pricing,
        raw: values.raw,
        source: values.source,
      })
      .onConflictDoUpdate({
        target: [cardPrice.game, cardPrice.tcggoCardId, cardPrice.pricedOn],
        set: {
          cardNumber: values.card.cardNumber,
          name: values.card.name,
          prices: values.card.pricing,
          raw: values.raw,
          source: values.source,
          fetchedAt: new Date(),
        },
      })
      .returning();
    if (row == null) throw new Error('Card price upsert did not return a row');

    return row;
  }

  static getCachedSearch(
    c: HonoContext,
    game: CardGame,
    normalizedQueryKey: string,
    pricedOn: string,
    database: PricingDatabase = c.get('db'),
  ): Promise<CardPriceSearchRow | undefined> {
    return database
      .select()
      .from(cardPriceSearch)
      .where(
        and(
          eq(cardPriceSearch.game, game),
          eq(cardPriceSearch.queryKey, normalizedQueryKey),
          eq(cardPriceSearch.pricedOn, pricedOn),
        ),
      )
      .limit(1)
      .then(rows => rows[0]);
  }

  static async upsertSearch(
    c: HonoContext,
    values: {
      game: CardGame;
      queryKey: string;
      pricedOn: string;
      tcggoCardIds: string[];
    },
    database: PricingDatabase = c.get('db'),
  ): Promise<void> {
    await database
      .insert(cardPriceSearch)
      .values(values)
      .onConflictDoUpdate({
        target: [cardPriceSearch.game, cardPriceSearch.queryKey, cardPriceSearch.pricedOn],
        set: { tcggoCardIds: values.tcggoCardIds, fetchedAt: new Date() },
      });
  }

  static async setOwnedCardTcggoId(c: HonoContext, ownedCardId: string, tcggoCardId: string): Promise<void> {
    const userId = getSessionWhereSessionIsRequired(c).user.id;
    await c
      .get('db')
      .update(card)
      .set({ tcggoCardId })
      .where(and(eq(card.id, ownedCardId), eq(card.userId, userId)));
  }

  static listOwnedCards(c: HonoContext, cards: CardWithQuantities[], game?: CardGame): CardWithQuantities[] {
    return game == null ? cards : cards.filter(ownedCard => ownedCard.game === game);
  }

  private static logLock(
    c: HonoContext,
    lock: PricingLock,
    lockStatus: 'acquired' | 'failed' | 'timeout',
    lockWaitMs: number,
    outcome: 'failure' | 'success',
  ) {
    const log = outcome === 'success' ? logInfo : logWarn;
    log(
      withRequestLogger(c, { component: 'card-pricing' }),
      {
        event: 'pricing.lock.completed',
        game: lock.game,
        lock_key_type: lock.keyType,
        lock_status: lockStatus,
        lock_wait_ms: lockWaitMs,
        outcome,
        priced_on: lock.pricedOn,
      },
      'Completed a card pricing lock operation.',
    );
  }
}

function postgresErrorCode(error: unknown): string | undefined {
  if (error == null || typeof error !== 'object') return undefined;
  if ('code' in error && typeof error.code === 'string') return error.code;
  if ('cause' in error) return postgresErrorCode(error.cause);
  return undefined;
}
