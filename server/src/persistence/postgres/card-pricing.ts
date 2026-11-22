import assert from 'node:assert/strict';

import { and, eq, sql } from 'drizzle-orm';

import { ONE_PIECE_VARIANT_SEPARATOR } from '../../card-pricing/constants.ts';
import type { CardPricingRepository } from '../../card-pricing/repository.ts';
import {
  CARD_GAME_MAP,
  isScrydexPricingSource,
  type CardGame,
  type PricingSource,
  type CardPriceRow,
  type CardPriceSearchRow,
  type CardPriceUpsertValues,
} from '../../card-pricing/types.ts';
import { EnglishSearchAliasResponseSchema } from '../../card-pricing/utils/english-search-alias.ts';
import { cachedIllustrator } from '../../card-pricing/utils/illustrator.ts';
import { normalizeCardNumber, normalizeName } from '../../card-pricing/utils/query.ts';
import type { OwnedCard } from '../../cards/types.ts';
import type { Database } from '../../db/index.ts';
import { cardPrice, cardPriceSearch } from '../../db/schema/card-pricing.ts';
import { card, cardMetadata } from '../../db/schema/cards.ts';
import { isNonEmpty, type NonEmptyArray } from '../../utils/type-utils.ts';
import type { AuthenticatedIdentity } from '../contracts.ts';

export class PostgresCardPricingRepository implements CardPricingRepository {
  private readonly db: Database;
  private readonly identity: AuthenticatedIdentity;

  constructor(db: Database, identity: AuthenticatedIdentity) {
    this.db = db;
    this.identity = identity;
  }

  private get userId() {
    return this.identity.requireUserId();
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

  getCachedCardPricesById(pricingSource: PricingSource, ids: readonly string[]): Promise<CardPriceRow[]> {
    if (ids.length === 0) {
      return Promise.resolve([]);
    }

    return this.db
      .select()
      .from(cardPrice)
      .where(and(eq(cardPrice.pricingSource, pricingSource), sql`${cardPrice.id} = any(${sql.param(ids)}::text[])`));
  }

  async findCachedPrinting(
    pricingSource: PricingSource,
    game: CardGame,
    printing: { name: string; setName: string; cardNumber: string },
  ): Promise<string | undefined> {
    const matches = await this.db
      .selectDistinct({ pricingCardId: cardPrice.pricingCardId })
      .from(cardPrice)
      .where(
        and(
          eq(cardPrice.pricingSource, pricingSource),
          eq(cardPrice.game, game),
          game === CARD_GAME_MAP.ONE_PIECE
            ? sql`strpos(${cardPrice.pricingCardId}, ${ONE_PIECE_VARIANT_SEPARATOR}) = 0`
            : undefined,
          sql`upper(btrim(regexp_replace(${cardPrice.cardNumber}, '[[:space:]]+', ' ', 'g'))) = ${normalizeCardNumber(printing.cardNumber)}`,
          sql`lower(btrim(regexp_replace(${cardPrice.name}, '[[:space:]]+', ' ', 'g'))) = ${normalizeName(printing.name).toLowerCase()}`,
          sql`lower(btrim(regexp_replace(${cardPrice.prices}->>'setName', '[[:space:]]+', ' ', 'g'))) = ${normalizeName(printing.setName).toLowerCase()}`,
        ),
      )
      .limit(2);

    return matches.length === 1 ? matches[0]?.pricingCardId : undefined;
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
    return this.db.transaction(async tx => {
      const rows = await tx
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

      const metadata = new Map<string, typeof cardMetadata.$inferInsert>();

      for (const value of values) {
        const illustrator = cachedIllustrator({ prices: value.card.pricing, raw: value.raw });

        const alias =
          value.game === CARD_GAME_MAP.POKEMON && isScrydexPricingSource(value.pricingSource)
            ? EnglishSearchAliasResponseSchema.safeParse(value.raw).data?.translation.en.name
            : undefined;

        if (illustrator == null && alias == null) {
          continue;
        }

        const identity = JSON.stringify([value.pricingSource, value.game, value.card.id]);
        const existing = metadata.get(identity);

        metadata.set(identity, {
          pricingSource: value.pricingSource,
          game: value.game,
          pricingCardId: value.card.id,
          illustrator: illustrator ?? existing?.illustrator,
          englishSearchAlias: alias ?? existing?.englishSearchAlias,
        });
      }

      if (metadata.size > 0) {
        const illustrator = sql`coalesce(excluded.illustrator, ${cardMetadata.illustrator})`;
        const alias = sql`coalesce(excluded.english_search_alias, ${cardMetadata.englishSearchAlias})`;

        await tx
          .insert(cardMetadata)
          .values([...metadata.values()])
          .onConflictDoUpdate({
            target: [cardMetadata.pricingSource, cardMetadata.game, cardMetadata.pricingCardId],
            set: { illustrator, englishSearchAlias: alias },
            setWhere: sql`${cardMetadata.illustrator} is distinct from ${illustrator}
              or ${cardMetadata.englishSearchAlias} is distinct from ${alias}`,
          });
      }

      assert(isNonEmpty(rows), 'Card price upsert did not return any rows');

      return rows;
    });
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
    hasMore: boolean;
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
        set: { pricingCardIds: values.pricingCardIds, hasMore: values.hasMore, fetchedAt: new Date() },
      });
  }

  /**
   * Links an owned card to its resolved provider identity when owned by the current session user.
   *
   * @param owned Owned card as read before pricing.
   * @param pricingCardId Provider card identifier to link.
   * @param pricingSource Provider and client mode that owns the identifier.
   */
  async setOwnedCardPricingIdentity(
    owned: OwnedCard,
    pricingCardId: string,
    pricingSource: PricingSource,
  ): Promise<void> {
    await this.db
      .update(card)
      .set({ pricingCardId, pricingSource })
      .where(
        and(
          eq(card.id, owned.id),
          eq(card.userId, this.userId),
          eq(card.game, owned.game),
          eq(card.name, owned.name),
          eq(card.setName, owned.setName),
          eq(card.cardNumber, owned.cardNumber),
          sql`${card.pricingCardId} is not distinct from ${owned.pricingCardId}`,
          sql`${card.pricingSource} is not distinct from ${owned.pricingSource}`,
        ),
      );
  }
}
