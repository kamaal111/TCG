import assert from 'node:assert/strict';

import { compactMap } from '@kamaalio/kamaal/arrays';
import { sha256Hex } from '@tcg/crypto/sha256';
import { InvalidValidation } from '@tcg/http/exceptions';
import { SCRYDEX_FIRST_PAGE, SCRYDEX_SEARCH_PAGE_SIZE } from '@tcg/scrydex';

import { buildCatalogQuery } from './catalog-query.ts';
import {
  PRICING_PROVIDER_OPERATION_MAP,
  type PricingClient,
  type PricingClientError,
  type PricingProviderOperation,
  type PricingSearchResult,
} from './client.ts';
import { ONE_PIECE_VARIANT_SEPARATOR } from './constants.ts';
import { PRICING_LOCK_KEY_TYPE_MAP } from './coordinator.ts';
import { CardPriceException, PricingCatalogUnavailable, PricingProviderUnavailable } from './exceptions.ts';
import { normalizeCardLanguages } from './languages.ts';
import { PRICING_CACHE_STATUS_MAP, PRICING_EVENT_MAP, type PricingLogFields, pricingLogger } from './logging.ts';
import { PricingOperation } from './operation.ts';
import type { CardPriceRow, CardPricingRepository } from './repository.ts';
import {
  OWNED_CARD_PRICE_STATUSES,
  type OwnedCardPriceResponse,
  type PricedCardResponse,
} from './schemas/responses.ts';
import {
  CARD_GAME_MAP,
  PRICING_SEARCH_MODE_MAP,
  type CardGame,
  type PricingCardRecord,
  type PricingSearchOptions,
} from './types.ts';
import { imageKeyForOriginURL, storageKeyForImageKey } from '../card-images/keys.ts';
import { imagesLogger } from '../card-images/logging.ts';
import type { CardImageRow } from '../card-images/repository.ts';
import type { CardWithPurchases } from '../cards/repository.ts';
import type { CatalogPrinting } from '../cards/types.ts';
import type { HonoContext } from '../context.ts';
import { isNonEmpty, type NonEmptyArray } from '../utils/type-utils.ts';
import { RealScrydexClient } from './scrydex/real-client.ts';
import { cachedIllustrator } from './utils/illustrator.ts';
import { searchPageKey } from './utils/pagination.ts';
import { serializeOwnedCardPrice, serializePricedCard } from './utils/pricing.ts';
import { printingKey } from './utils/printing-key.ts';
import { buildSearchQuery, normalizeCardNumber, normalizeName, queryKey, todayUTC } from './utils/query.ts';
import type { WishlistEntry } from '../wishlist/repository.ts';

const PRICING_LOOKUP_CONCURRENCY = 4;

export class CardPricingService {
  private readonly c: HonoContext;
  private readonly operation: PricingOperation;

  constructor(c: HonoContext) {
    this.c = c;
    this.operation = new PricingOperation(c);
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
    options: PricingSearchOptions,
    offset: number,
  ): Promise<{ normalizedQuery: string; matches: PricedCardResponse[]; hasMore: boolean }> {
    const normalizedQuery = normalizeName(query);
    const selectedLanguages = normalizeCardLanguages(game, options.languages);
    const normalizedQueryKey = searchPageKey(queryKey(game, normalizedQuery, options), offset);
    const pricedOn = todayUTC();
    const cached = await this.cachedSearch(game, normalizedQuery, normalizedQueryKey, pricedOn);

    if (cached != null) {
      return cached;
    }

    this.logCache(PRICING_EVENT_MAP.SEARCH_CACHE, PRICING_CACHE_STATUS_MAP.MISS, 0);

    const result = await this.operation.withPricingLock(
      {
        game,
        key: `pricing:search:${this.client.source}:${pricedOn}:${game}:${normalizedQueryKey}`,
        keyType: PRICING_LOCK_KEY_TYPE_MAP.SEARCH,
        pricedOn,
      },
      async () => {
        const populated = await this.cachedSearch(game, normalizedQuery, normalizedQueryKey, pricedOn);

        if (populated != null) {
          return populated;
        }

        const providerStartedAt = performance.now();

        const searchResult = await this.client.searchCards(
          game,
          normalizedQuery,
          { ...options, languages: selectedLanguages },
          offset / SCRYDEX_SEARCH_PAGE_SIZE + SCRYDEX_FIRST_PAGE,
        );

        if (searchResult.isErr()) {
          this.throwProviderUnavailable(
            PRICING_PROVIDER_OPERATION_MAP.SEARCH,
            game,
            searchResult.error,
            providerStartedAt,
          );
        }

        this.logProviderSuccess(
          PRICING_PROVIDER_OPERATION_MAP.SEARCH,
          game,
          searchResult.value,
          providerStartedAt,
          undefined,
          searchResult.value.records.length,
        );

        const rows = await this.cacheSearchPrices(game, pricedOn, searchResult.value.records);

        await this.registerImages(rows);
        await this.repository.upsertSearch({
          pricingSource: this.client.source,
          game,
          queryKey: normalizedQueryKey,
          pricedOn,
          pricingCardIds: rows.map(row => row.pricingCardId),
          hasMore: searchResult.value.hasMore,
        });
        this.logCache(PRICING_EVENT_MAP.SEARCH_CACHE, PRICING_CACHE_STATUS_MAP.SET, rows.length);

        return {
          normalizedQuery,
          hasMore: searchResult.value.hasMore,
          matches: rows.map(row => serializePricedCard(game, row, this.c.get('config').PUBLIC_BASE_URL)),
        };
      },
    );

    if (result.isErr()) {
      throw result.error;
    }

    return result.value;
  }

  async searchCatalogAndPrice(
    game: CardGame,
    query: string,
    options: PricingSearchOptions,
    offset: number,
    requestedGeneration: string | undefined,
  ) {
    const catalog = this.c.get('cardCatalog');
    const client = this.client;

    if (catalog == null || !(client instanceof RealScrydexClient)) {
      throw new PricingCatalogUnavailable(this.c);
    }

    const generation =
      requestedGeneration == null
        ? await catalog.readyGeneration(game, this.c.req.raw.signal)
        : (await catalog.repository.generation(game, requestedGeneration))?.id;

    if (generation == null) {
      if (requestedGeneration != null) {
        throw new InvalidValidation(this.c, [
          { path: ['cursor'], message: 'Search cursor has expired. Search again.' },
        ]);
      }

      throw new PricingCatalogUnavailable(this.c);
    }

    const page = await catalog.repository.search(
      generation,
      buildCatalogQuery(game, query),
      normalizeCardLanguages(game, options.languages),
      offset,
    );

    const ids = page.printings.map(printing => printing.pricingId);

    if (ids.length === 0) {
      return { matches: [], generation, nextOffset: page.nextOffset };
    }

    const pricedOn = todayUTC();

    const loadCached = async () => {
      const rows = await this.repository.getCachedCardPrices(client.source, game, ids, pricedOn);

      return new Map(rows.map(row => [row.pricingCardId, row] as const));
    };

    let rows = await loadCached();

    if (rows.size < ids.length) {
      const pageKey = sha256Hex(JSON.stringify(ids.toSorted()));

      const result = await this.operation.withPricingLock(
        {
          game,
          key: `pricing:catalog:${client.source}:${game}:${pricedOn}:${pageKey}`,
          keyType: PRICING_LOCK_KEY_TYPE_MAP.SEARCH,
          pricedOn,
        },
        async () => {
          const cached = await loadCached();
          const missing = page.printings.filter(printing => !cached.has(printing.pricingId));
          const providerIds = [...new Set(missing.map(printing => printing.providerId))];

          if (providerIds.length === 0) {
            return cached;
          }

          const startedAt = performance.now();
          const response = await client.priceCatalogCards(game, providerIds);

          if (response.isErr()) {
            this.throwProviderUnavailable(PRICING_PROVIDER_OPERATION_MAP.SEARCH, game, response.error, startedAt);
          }

          this.logProviderSuccess(
            PRICING_PROVIDER_OPERATION_MAP.SEARCH,
            game,
            response.value,
            startedAt,
            undefined,
            response.value.records.length,
          );
          const upserted = await this.cacheSearchPrices(game, pricedOn, response.value.records);
          const requestedIds = new Set(ids);

          for (const row of upserted) {
            if (requestedIds.has(row.pricingCardId)) {
              cached.set(row.pricingCardId, row);
            }
          }

          return cached;
        },
      );

      if (result.isErr()) {
        throw result.error;
      }

      rows = result.value;
    }

    await this.registerImages([...rows.values()]);

    const matches = page.printings.flatMap(printing => {
      const row = rows.get(printing.pricingId);

      if (row == null) {
        return [];
      }

      const card = serializePricedCard(game, row, this.c.get('config').PUBLIC_BASE_URL);

      return [printing.setName == null ? card : { ...card, set_name: printing.setName }];
    });

    return { matches, generation, nextOffset: page.nextOffset };
  }

  /**
   * Prices owned cards, resolving provider identities when missing or owned by another source.
   *
   * @param cards Owned cards to price.
   * @param options.allowUnavailable When true, a per-card pricing lock acquisition or provider failure is reported as
   * `UNAVAILABLE` for that card instead of failing the whole batch.
   * @returns Price responses for each card, in the same order as `cards`.
   */
  async priceOwnedCards(
    cards: NonEmptyArray<CardWithPurchases>,
    options: { allowUnavailable?: boolean },
  ): Promise<NonEmptyArray<OwnedCardPriceResponse>> {
    const pending = cards.entries();
    const prices: OwnedCardPriceResponse[] = [];

    const worker = async () => {
      for (const [index, card] of pending) {
        try {
          prices[index] = await this.priceOwnedCard(card);
        } catch (error) {
          if (options.allowUnavailable && error instanceof CardPriceException) {
            prices[index] = { card_id: card.id, status: OWNED_CARD_PRICE_STATUSES.UNAVAILABLE };
          } else {
            throw error;
          }
        }
      }
    };

    await Promise.all(Array.from({ length: Math.min(PRICING_LOOKUP_CONCURRENCY, cards.length) }, worker));
    const [priced, ...rest] = prices;

    assert(priced != null, 'Owned card pricing did not return a result for at least one card');

    return [priced, ...rest];
  }

  async priceWishlistEntries(entries: WishlistEntry[]): Promise<ReadonlyMap<string, PricedCardResponse>> {
    const pricedOn = todayUTC();
    const identities = compactMap(entries, ({ pricingIdentity }) => pricingIdentity);
    const groups = Map.groupBy(identities, identity => `${identity.pricingSource}:${identity.game}`);

    const cached = await Promise.all(
      Array.from(groups.values(), ([first, ...rest]) => {
        assert(first != null, 'A pricing identity group must be nonempty');
        const ids = new Set([first.pricingCardId, ...rest.map(identity => identity.pricingCardId)]);

        return this.repository.getCachedCardPrices(first.pricingSource, first.game, [...ids], pricedOn);
      }),
    );

    const prices = new Map(
      cached
        .flat()
        .map(row => [printingKey(row), serializePricedCard(row.game, row, this.c.get('config').PUBLIC_BASE_URL)]),
    );

    const misses = new Map(
      compactMap(entries, entry => {
        const key = entry.card.printing_key;

        return prices.has(key) ? undefined : ([key, entry] as const);
      }),
    );

    const pending = misses.values();
    const searches = new Map<string, ReturnType<CardPricingService['searchAndPrice']>>();

    const worker = async () => {
      for (const { card, pricingIdentity } of pending) {
        try {
          let price: PricedCardResponse | undefined;

          if (pricingIdentity?.pricingSource === this.client.source) {
            price = await this.fetchPrintingById(card.game, pricingIdentity.pricingCardId, pricedOn);
          } else if (pricingIdentity == null) {
            const query = buildSearchQuery(card.name, card.card_number);
            const options = { languages: [], searchBy: PRICING_SEARCH_MODE_MAP.CARD } as const;
            const key = queryKey(card.game, query, options);
            let search = searches.get(key);

            if (search == null) {
              search = this.searchAndPrice(card.game, query, options, 0);
              searches.set(key, search);
            }

            price = (await search).matches.find(match => match.printing_key === card.printing_key);
          }

          if (price?.printing_key === card.printing_key) {
            prices.set(card.printing_key, price);
          }
        } catch (error) {
          if (!(error instanceof CardPriceException)) {
            throw error;
          }
        }
      }
    };

    await Promise.all(Array.from({ length: Math.min(PRICING_LOOKUP_CONCURRENCY, misses.size) }, worker));

    return prices;
  }

  async catalogPrintings(ids: readonly string[]): Promise<ReadonlyMap<string, CatalogPrinting>> {
    const rows = await this.repository.getCachedCardPricesById(this.client.source, ids);

    return new Map(
      rows.map(row => {
        return [
          row.id,
          {
            game: row.game,
            name: row.name,
            setName: row.prices.setName ?? '',
            cardNumber: row.cardNumber,
            illustrator: cachedIllustrator(row),
            pricingCardId: row.pricingCardId,
            pricingSource: row.pricingSource,
          },
        ];
      }),
    );
  }

  private async priceOwnedCard(card: CardWithPurchases): Promise<OwnedCardPriceResponse> {
    const pricingCardId = card.pricingCardId;

    if (pricingCardId != null && card.pricingSource === this.client.source) {
      return this.priceOwnedCardById({ ...card, pricingCardId });
    }

    const cachedIdentity = await this.repository.findCachedPrinting(this.client.source, card.game, card);

    if (cachedIdentity != null) {
      await this.repository.setOwnedCardPricingIdentity(card, cachedIdentity, this.client.source);

      return this.priceOwnedCardById({ ...card, pricingCardId: cachedIdentity });
    }

    const query = buildSearchQuery(card.name, card.cardNumber);

    const search = await this.searchAndPrice(
      card.game,
      query,
      { languages: [], searchBy: PRICING_SEARCH_MODE_MAP.CARD },
      0,
    );

    const normalizedNumber = normalizeCardNumber(card.cardNumber);
    const normalizedName = normalizeName(card.name).toLowerCase();

    const candidates = search.matches.filter(candidate => {
      return (
        normalizeCardNumber(candidate.card_number) === normalizedNumber ||
        normalizeName(candidate.name).toLowerCase() === normalizedName
      );
    });

    const rows = await this.repository.getCachedCardPricesById(
      this.client.source,
      candidates.map(candidate => candidate.id),
    );

    const rowsById = new Map(rows.map(row => [row.id, row]));

    const eligibleMatches = candidates.flatMap(candidate => {
      const row = rowsById.get(candidate.id);

      if (
        row == null ||
        (card.game === CARD_GAME_MAP.ONE_PIECE && row.pricingCardId.includes(ONE_PIECE_VARIANT_SEPARATOR))
      ) {
        return [];
      }

      return [{ candidate, row }];
    });

    const matched =
      eligibleMatches.find(({ candidate }) => normalizeCardNumber(candidate.card_number) === normalizedNumber) ??
      eligibleMatches[0];

    if (matched == null) {
      return { card_id: card.id, status: OWNED_CARD_PRICE_STATUSES.NO_MATCH };
    }

    await this.repository.setOwnedCardPricingIdentity(card, matched.row.pricingCardId, this.client.source);

    return serializeOwnedCardPrice(card.id, matched.candidate);
  }

  private async priceOwnedCardById(
    card: Omit<CardWithPurchases, 'pricingCardId'> & {
      pricingCardId: NonNullable<CardWithPurchases['pricingCardId']>;
    },
  ): Promise<OwnedCardPriceResponse> {
    const pricedOn = todayUTC();

    const cached = await this.repository.getCachedCardPrice(
      this.client.source,
      card.game,
      card.pricingCardId,
      pricedOn,
    );

    if (cached != null) {
      await this.registerImages([cached]);
      this.logCache(PRICING_EVENT_MAP.OWNED_CACHE, PRICING_CACHE_STATUS_MAP.HIT, 1, card.id);

      return serializeOwnedCardPrice(
        card.id,
        serializePricedCard(card.game, cached, this.c.get('config').PUBLIC_BASE_URL),
      );
    }

    this.logCache(PRICING_EVENT_MAP.OWNED_CACHE, PRICING_CACHE_STATUS_MAP.MISS, 0, card.id);
    const price = await this.fetchPrintingById(card.game, card.pricingCardId, pricedOn, card.id);

    return price == null
      ? { card_id: card.id, status: OWNED_CARD_PRICE_STATUSES.NO_MATCH }
      : serializeOwnedCardPrice(card.id, price);
  }

  private async fetchPrintingById(
    game: CardGame,
    pricingCardId: string,
    pricedOn: string,
    ownedCardId?: string,
  ): Promise<PricedCardResponse | undefined> {
    const result = await this.operation.withPricingLock(
      {
        game,
        key: `pricing:card:${this.client.source}:${pricedOn}:${game}:${pricingCardId}`,
        keyType: PRICING_LOCK_KEY_TYPE_MAP.CARD,
        pricedOn,
      },
      async () => {
        const populated = await this.repository.getCachedCardPrice(this.client.source, game, pricingCardId, pricedOn);

        if (populated != null) {
          await this.registerImages([populated]);

          if (ownedCardId != null) {
            this.logCache(PRICING_EVENT_MAP.OWNED_CACHE, PRICING_CACHE_STATUS_MAP.HIT, 1, ownedCardId);
          }

          return serializePricedCard(game, populated, this.c.get('config').PUBLIC_BASE_URL);
        }

        const providerStartedAt = performance.now();
        const cardResult = await this.client.getCardById(game, pricingCardId);

        if (cardResult.isErr()) {
          this.throwProviderUnavailable(
            PRICING_PROVIDER_OPERATION_MAP.CARD_LOOKUP,
            game,
            cardResult.error,
            providerStartedAt,
            ownedCardId,
          );
        }

        const record = cardResult.value;
        this.logProviderSuccess(
          PRICING_PROVIDER_OPERATION_MAP.CARD_LOOKUP,
          game,
          undefined,
          providerStartedAt,
          ownedCardId,
          record == null ? 0 : 1,
        );

        if (record == null) {
          return undefined;
        }

        const row = await this.repository.upsertCardPrice({
          game,
          card: record.card,
          raw: record.raw,
          pricedOn,
          pricingSource: this.client.source,
        });

        await this.registerImages([row]);

        if (ownedCardId != null) {
          this.logCache(PRICING_EVENT_MAP.OWNED_CACHE, PRICING_CACHE_STATUS_MAP.SET, 1, ownedCardId);
        }

        return serializePricedCard(game, row, this.c.get('config').PUBLIC_BASE_URL);
      },
    );

    if (result.isErr()) {
      throw result.error;
    }

    return result.value;
  }

  private async cachedSearch(
    game: CardGame,
    normalizedQuery: string,
    normalizedQueryKey: string,
    pricedOn: string,
  ): Promise<{ normalizedQuery: string; matches: PricedCardResponse[]; hasMore: boolean } | undefined> {
    const cachedSearch = await this.repository.getCachedSearch(this.client.source, game, normalizedQueryKey, pricedOn);

    if (cachedSearch == null) {
      return undefined;
    }

    const rows = await this.repository.getCachedCardPrices(
      this.client.source,
      game,
      cachedSearch.pricingCardIds,
      pricedOn,
    );

    const rowsById = new Map(rows.map(row => [row.pricingCardId, row]));

    const orderedRows = cachedSearch.pricingCardIds.flatMap(id => {
      const row = rowsById.get(id);

      return row == null ? [] : [row];
    });

    await this.registerImages(orderedRows);
    const matches = orderedRows.map(row => serializePricedCard(game, row, this.c.get('config').PUBLIC_BASE_URL));
    this.logCache(PRICING_EVENT_MAP.SEARCH_CACHE, PRICING_CACHE_STATUS_MAP.HIT, matches.length);

    return { normalizedQuery, matches, hasMore: cachedSearch.hasMore };
  }

  private async cacheSearchPrices(
    game: CardGame,
    pricedOn: string,
    records: readonly PricingCardRecord[],
  ): Promise<CardPriceRow[]> {
    const recordsById = new Map<string, PricingCardRecord>();

    for (const record of records) {
      if (!recordsById.has(record.card.id)) {
        recordsById.set(record.card.id, record);
      }
    }

    const values = [...recordsById.values()].map(({ card, raw }) => ({
      game,
      card,
      raw,
      pricedOn,
      pricingSource: this.client.source,
    }));

    if (!isNonEmpty(values)) {
      return [];
    }

    const rows = await this.repository.upsertCardPrices(values);
    const rowsById = new Map(rows.map(row => [row.pricingCardId, row]));

    return values.map(({ card }) => {
      const row = rowsById.get(card.id);
      assert(row != null, `Bulk card price upsert did not return card ${card.id}`);

      return row;
    });
  }

  private async registerImages(rows: CardPriceRow[]): Promise<void> {
    const uniqueOrigins = new Set(rows.flatMap(row => (row.prices.image == null ? [] : [row.prices.image])));

    const originsToRegister = uniqueOrigins
      .values()
      .map(originUrl => {
        const imageKey = imageKeyForOriginURL(originUrl);
        const storageKey = storageKeyForImageKey(imageKey);

        return { imageKey, originUrl, storageKey };
      })
      .toArray();

    let registered: CardImageRow[] | undefined = undefined;

    try {
      registered = await this.c.get('cardImageRepository').registerMany(originsToRegister);
    } catch (err) {
      imagesLogger(this.c).error(
        { event: 'images.register', outcome: 'failure', error_code: 'CARD_IMAGE_REGISTER_FAILED', err },
        'Failed to register card images without failing pricing.',
      );

      return;
    }

    imagesLogger(this.c).info(
      {
        event: 'images.register',
        outcome: 'success',
        cache_status: registered.length > 0 ? 'set' : 'hit',
        result_count: registered.length,
      },
      'Registered card images for proxy delivery.',
    );

    if (this.c.get('config').CARD_IMAGE_WORKER_ENABLED && this.c.get('config').CARD_IMAGE_WARM_ON_REGISTER) {
      this.c.get('cardImageWarmer').notifyRegistered(registered.length);
    }
  }

  private throwProviderUnavailable(
    operation: PricingProviderOperation,
    game: CardGame,
    error: PricingClientError,
    startedAt: number,
    cardId?: string,
  ): never {
    this.logger.warn(
      {
        event: PRICING_EVENT_MAP.PROVIDER_REQUEST_COMPLETED,
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
    operation: PricingProviderOperation,
    game: CardGame,
    searchResult: PricingSearchResult | undefined,
    startedAt: number,
    cardId: string | undefined,
    resultCount: number,
  ) {
    this.logger.info(
      {
        event: PRICING_EVENT_MAP.PROVIDER_REQUEST_COMPLETED,
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
    cacheStatus: NonNullable<PricingLogFields['cache_status']>,
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
