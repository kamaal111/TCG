import assert from 'node:assert/strict';

import type { CardWithQuantities } from '../cards/repository.ts';
import type { HonoContext } from '../context.ts';
import type { PricingClient, PricingClientError, PricingSearchResult } from './client.ts';
import { PricingLockTimeout, PricingProviderUnavailable } from './exceptions.ts';
import { type PricingLogFields, pricingLogger } from './logging.ts';
import type { CardPricingRepository } from './repository.ts';
import {
  OWNED_CARD_PRICE_STATUSES,
  type OwnedCardPriceResponse,
  type PricedCardResponse,
} from './schemas/responses.ts';
import type { CardGame, PricingCardRecord } from './types.ts';
import { serializePricedCard } from './utils/pricing.ts';
import { buildSearchQuery, normalizeCardNumber, normalizeName, queryKey, todayUTC } from './utils/query.ts';
import { isNonEmpty, type NonEmptyArray } from '../utils/type-utils.ts';

export class CardPricingService {
  private readonly c: HonoContext;

  constructor(c: HonoContext) {
    this.c = c;
  }

  private get repository(): CardPricingRepository {
    return this.c.get('cardPricingRepository');
  }

  private get client(): PricingClient {
    return this.c.get('pricingClient');
  }

  private get logger() {
    return pricingLogger(this.c);
  }

  /**
   * Searches the configured pricing provider and serves daily cached results when available.
   *
   * @param game Card game to search within.
   * @param query Raw search query text.
   * @returns The normalized query and priced matches.
   */
  async searchAndPrice(
    game: CardGame,
    query: string,
  ): Promise<{ normalizedQuery: string; matches: PricedCardResponse[] }> {
    const normalizedQuery = normalizeName(query);
    const normalizedQueryKey = queryKey(game, normalizedQuery);
    const pricedOn = todayUTC();
    const cached = await this.cachedSearch(game, normalizedQuery, normalizedQueryKey, pricedOn);
    if (cached != null) return cached;

    this.logCache('pricing.search.cache', 'miss', 0);
    return this.repository.withPricingLock(
      {
        game,
        key: `pricing:search:${this.client.source}:${pricedOn}:${game}:${normalizedQueryKey}`,
        keyType: 'search',
        pricedOn,
      },
      async () => {
        const populated = await this.cachedSearch(game, normalizedQuery, normalizedQueryKey, pricedOn);
        if (populated != null) return populated;

        const providerStartedAt = performance.now();
        const searchResult = await this.client.searchCards(game, normalizedQuery);
        if (searchResult.isErr()) {
          this.throwProviderUnavailable('search', game, searchResult.error, providerStartedAt);
        }
        this.logProviderSuccess('search', game, searchResult.value, providerStartedAt);

        const normalizedCardsById = searchResult.value.records.reduce((normalizedCardsById, record) => {
          if (!normalizedCardsById.has(record.card.id)) {
            return normalizedCardsById.set(record.card.id, record);
          }

          return normalizedCardsById;
        }, new Map<string, PricingCardRecord>());
        const normalizedCards = normalizedCardsById.values().toArray();
        const upsertValues = normalizedCards.map(({ card, raw }) => ({
          game,
          card,
          raw,
          pricedOn,
          pricingSource: this.client.source,
        }));
        const upsertedRows = isNonEmpty(upsertValues) ? await this.repository.upsertCardPrices(upsertValues) : [];
        const rowsByPricingCardId = new Map(upsertedRows.map(row => [row.pricingCardId, row]));
        const rows = normalizedCards.map(({ card }) => {
          const row = rowsByPricingCardId.get(card.id);
          assert(row != null, `Bulk card price upsert did not return card ${card.id}`);

          return row;
        });
        await this.repository.upsertSearch({
          pricingSource: this.client.source,
          game,
          queryKey: normalizedQueryKey,
          pricedOn,
          pricingCardIds: rows.map(row => row.pricingCardId),
        });
        this.logCache('pricing.search.cache', 'set', rows.length);

        return { normalizedQuery, matches: rows.map(row => serializePricedCard(game, row)) };
      },
    );
  }

  /**
   * Prices owned cards, resolving provider identities when missing or owned by another source.
   *
   * @param cards Owned cards to price.
   * @param options.allowUnavailable When true, a per-card pricing lock timeout is reported as
   * `UNAVAILABLE` for that card instead of failing the whole batch.
   * @returns Price responses for each card, in the same order as `cards`.
   */
  async priceOwnedCards(
    cards: NonEmptyArray<CardWithQuantities>,
    options: { allowUnavailable?: boolean } = {},
  ): Promise<NonEmptyArray<OwnedCardPriceResponse>> {
    const [priced, ...rest] = await Promise.all(
      cards.map(async card => {
        try {
          return await this.priceOwnedCard(card);
        } catch (error) {
          if (options.allowUnavailable && error instanceof PricingLockTimeout) {
            return { card_id: card.id, status: OWNED_CARD_PRICE_STATUSES.UNAVAILABLE };
          }
          throw error;
        }
      }),
    );
    assert(priced != null, 'Owned card pricing did not return a result for at least one card');

    return [priced, ...rest];
  }

  private async priceOwnedCard(card: CardWithQuantities): Promise<OwnedCardPriceResponse> {
    const pricingCardId = card.pricingCardId;
    if (pricingCardId != null && card.pricingSource === this.client.source) {
      return this.priceOwnedCardById({ ...card, pricingCardId });
    }

    const query = buildSearchQuery(card.name, card.cardNumber);
    const search = await this.searchAndPrice(card.game, query);
    const normalizedNumber = normalizeCardNumber(card.cardNumber);
    const numberMatch = search.matches.find(
      candidate => normalizeCardNumber(candidate.card_number) === normalizedNumber,
    );
    const normalizedName = normalizeName(card.name).toLowerCase();
    const matched =
      numberMatch ?? search.matches.find(candidate => normalizeName(candidate.name).toLowerCase() === normalizedName);
    if (matched == null) return { card_id: card.id, status: OWNED_CARD_PRICE_STATUSES.NO_MATCH };

    const matchedRow = await this.repository.getCachedCardPriceById(
      this.client.source,
      card.game,
      matched.id,
      todayUTC(),
    );
    if (matchedRow == null) return { card_id: card.id, status: OWNED_CARD_PRICE_STATUSES.NO_MATCH };

    await this.repository.setOwnedCardPricingIdentity(card.id, matchedRow.pricingCardId, this.client.source);
    return this.makeOwnedResponse(card.id, matched);
  }

  private async priceOwnedCardById(
    card: Omit<CardWithQuantities, 'pricingCardId'> & {
      pricingCardId: NonNullable<CardWithQuantities['pricingCardId']>;
    },
  ): Promise<OwnedCardPriceResponse> {
    const pricingCardId = card.pricingCardId;
    const pricedOn = todayUTC();
    const cached = await this.repository.getCachedCardPrice(this.client.source, card.game, pricingCardId, pricedOn);
    if (cached != null) {
      this.logCache('pricing.owned.cache', 'hit', 1, card.id);
      return this.makeOwnedResponse(card.id, serializePricedCard(card.game, cached));
    }

    this.logCache('pricing.owned.cache', 'miss', 0, card.id);
    return this.repository.withPricingLock(
      {
        game: card.game,
        key: `pricing:card:${this.client.source}:${pricedOn}:${card.game}:${pricingCardId}`,
        keyType: 'card',
        pricedOn,
      },
      async () => {
        const populated = await this.repository.getCachedCardPrice(
          this.client.source,
          card.game,
          pricingCardId,
          pricedOn,
        );
        if (populated != null) {
          this.logCache('pricing.owned.cache', 'hit', 1, card.id);
          return this.makeOwnedResponse(card.id, serializePricedCard(card.game, populated));
        }

        const providerStartedAt = performance.now();
        const cardResult = await this.client.getCardById(card.game, pricingCardId);
        if (cardResult.isErr()) {
          this.throwProviderUnavailable('card_lookup', card.game, cardResult.error, providerStartedAt, card.id);
        }
        const record = cardResult.value;
        this.logProviderSuccess(
          'card_lookup',
          card.game,
          undefined,
          providerStartedAt,
          card.id,
          record == null ? 0 : 1,
        );
        if (record == null) return { card_id: card.id, status: OWNED_CARD_PRICE_STATUSES.NO_MATCH };

        const row = await this.repository.upsertCardPrice({
          game: card.game,
          card: record.card,
          raw: record.raw,
          pricedOn,
          pricingSource: this.client.source,
        });
        this.logCache('pricing.owned.cache', 'set', 1, card.id);
        return this.makeOwnedResponse(card.id, serializePricedCard(card.game, row));
      },
    );
  }

  private async cachedSearch(
    game: CardGame,
    normalizedQuery: string,
    normalizedQueryKey: string,
    pricedOn: string,
  ): Promise<{ normalizedQuery: string; matches: PricedCardResponse[] } | undefined> {
    const cachedSearch = await this.repository.getCachedSearch(this.client.source, game, normalizedQueryKey, pricedOn);
    if (cachedSearch == null) return undefined;

    const rows = await this.repository.getCachedCardPrices(
      this.client.source,
      game,
      cachedSearch.pricingCardIds,
      pricedOn,
    );
    const rowsById = new Map(rows.map(row => [row.pricingCardId, row]));
    const matches = cachedSearch.pricingCardIds.flatMap(id => {
      const row = rowsById.get(id);
      return row == null ? [] : [serializePricedCard(game, row)];
    });
    this.logCache('pricing.search.cache', 'hit', matches.length);
    return { normalizedQuery, matches };
  }

  private makeOwnedResponse(cardId: string, price: PricedCardResponse): OwnedCardPriceResponse {
    return {
      card_id: cardId,
      status: price.market == null ? OWNED_CARD_PRICE_STATUSES.NO_PRICE : OWNED_CARD_PRICE_STATUSES.PRICED,
      priced_card: price,
    };
  }

  private throwProviderUnavailable(
    operation: 'card_lookup' | 'search',
    game: CardGame,
    error: PricingClientError,
    startedAt: number,
    cardId?: string,
  ): never {
    this.logger.warn(
      {
        event: 'pricing.provider.request_completed',
        outcome: 'failure',
        error_code: 'PRICING_PROVIDER_UNAVAILABLE',
        provider: 'scrydex',
        provider_operation: operation,
        pricing_source: this.client.source,
        provider_error_reason: error.reason,
        provider_error_message: error.message,
        provider_status_code: error.statusCode,
        is_retryable: error.isRetryable,
        duration_ms: Math.round(performance.now() - startedAt),
        game,
        card_id: cardId,
      },
      'Scrydex pricing request failed.',
    );
    throw new PricingProviderUnavailable(this.c);
  }

  private logProviderSuccess(
    operation: 'card_lookup' | 'search',
    game: CardGame,
    searchResult: PricingSearchResult | undefined,
    startedAt: number,
    cardId?: string,
    resultCount = searchResult?.records.length ?? 0,
  ) {
    this.logger.info(
      {
        event: 'pricing.provider.request_completed',
        outcome: 'success',
        provider: 'scrydex',
        provider_operation: operation,
        pricing_source: this.client.source,
        game,
        card_id: cardId,
        result_count: resultCount,
        provider_result_count: searchResult?.providerResultCount,
        rejected_count: searchResult?.rejectedCount,
        missing_base_variant_count: searchResult?.missingBaseVariantCount,
        priced_count: searchResult?.records.filter(record => record.card.pricing.market != null).length,
        duration_ms: Math.round(performance.now() - startedAt),
      },
      'Completed a Scrydex pricing request.',
    );
  }

  private logCache(
    event: Extract<PricingLogFields['event'], `pricing.${string}.cache`>,
    cacheStatus: 'hit' | 'miss' | 'set',
    resultCount: number,
    cardId?: string,
  ) {
    this.logger.info(
      {
        event,
        outcome: 'success',
        cache_status: cacheStatus,
        result_count: resultCount,
        card_id: cardId,
        pricing_source: this.client.source,
      },
      'Completed a card pricing cache lookup.',
    );
  }
}
