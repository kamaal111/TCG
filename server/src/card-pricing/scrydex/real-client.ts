import {
  SCRYDEX_FIRST_PAGE,
  ScrydexClient,
  type ScrydexCatalogCollection,
  type ScrydexClientOptions,
  type ScrydexRawCard,
} from '@tcg/scrydex';
import { err, ok } from 'neverthrow';
import { z } from 'zod';

import {
  type PricingClient,
  type PricingClientResult,
  PRICING_CLIENT_ERROR_REASONS,
  type PricingSearchResult,
} from '../client.ts';
import { type CardGame, type PricingCardRecord, type PricingSearchOptions, PRICING_SOURCES } from '../types.ts';
import { normalizeScrydexLookup, normalizeScrydexSearch, splitScrydexPricingId } from './normalize.ts';
import { buildScrydexQuery, escapeScrydexValue, MAX_ENCODED_SCRYDEX_QUERY_LENGTH } from './query.ts';

export class RealScrydexClient implements PricingClient {
  readonly source = PRICING_SOURCES.SCRYDEX_REAL;
  private readonly client: ScrydexClient;

  constructor(options: ScrydexClientOptions) {
    this.client = new ScrydexClient(options);
  }

  async searchCards(
    game: CardGame,
    query: string,
    options: PricingSearchOptions,
    page: number,
  ): Promise<PricingClientResult<PricingSearchResult>> {
    const result = await this.client.searchCards(game, buildScrydexQuery(game, query, options), page);

    if (result.isErr()) {
      return err(result.error);
    }

    return ok(normalizeScrydexSearch(game, result.value.cards, result.value));
  }

  catalogPage(game: CardGame, collection: ScrydexCatalogCollection, page: number) {
    return this.client.listCatalog(game, collection, page);
  }

  async priceCatalogCards(
    game: CardGame,
    providerIds: readonly string[],
  ): Promise<PricingClientResult<PricingSearchResult>> {
    const batches = this.catalogPriceBatches(providerIds);
    const cards = new Map<string, ScrydexRawCard>();

    if (batches == null) {
      return this.invalidPriceBatch();
    }

    for (const { query, ids } of batches) {
      const result = await this.client.searchCards(game, query, SCRYDEX_FIRST_PAGE);

      if (result.isErr()) {
        return err(result.error);
      }

      if (
        result.value.hasMore ||
        result.value.rejectedCount > 0 ||
        result.value.providerResultCount !== result.value.cards.length
      ) {
        return this.invalidPriceBatch();
      }

      for (const card of result.value.cards) {
        const id = z.string().safeParse(card.id).data;

        if (id == null || !ids.has(id) || cards.has(id)) {
          return this.invalidPriceBatch();
        }

        cards.set(id, card);
      }
    }

    const normalized = normalizeScrydexSearch(game, [...cards.values()], {
      providerResultCount: cards.size,
      hasMore: false,
      rejectedCount: 0,
    });

    return normalized.rejectedCount === 0 ? ok(normalized) : this.invalidPriceBatch();
  }

  async getCardById(game: CardGame, id: string): Promise<PricingClientResult<PricingCardRecord | null>> {
    const { providerId, variantName } = splitScrydexPricingId(game, id);
    const result = await this.client.getCardById(game, providerId);

    if (result.isErr()) {
      return err(result.error);
    }

    if (result.value == null) {
      return ok(null);
    }

    const normalized = normalizeScrydexLookup(game, result.value.card, variantName);

    if (normalized == null && variantName != null) {
      return ok(null);
    }

    if (normalized == null) {
      return err({
        reason: PRICING_CLIENT_ERROR_REASONS.INVALID_RESPONSE,
        message: 'Scrydex card lookup returned an unusable card',
        statusCode: result.value.statusCode,
        isRetryable: false,
      });
    }

    return ok({ card: normalized.card, raw: result.value.card });
  }

  private catalogPriceBatches(providerIds: readonly string[]) {
    const batches: { query: string; ids: ReadonlySet<string> }[] = [];
    let query = '';
    let ids = new Set<string>();

    for (const id of providerIds) {
      const clause = `!id:"${escapeScrydexValue(id)}"`;
      const combined = query.length > 0 ? `${query} OR ${clause}` : clause;

      if (new URLSearchParams({ q: combined }).toString().length > MAX_ENCODED_SCRYDEX_QUERY_LENGTH) {
        if (new URLSearchParams({ q: clause }).toString().length > MAX_ENCODED_SCRYDEX_QUERY_LENGTH) {
          return undefined;
        }

        batches.push({ query, ids });
        query = clause;
        ids = new Set([id]);
      } else {
        query = combined;
        ids.add(id);
      }
    }

    if (ids.size > 0) {
      batches.push({ query, ids });
    }

    return batches;
  }

  private invalidPriceBatch(): PricingClientResult<PricingSearchResult> {
    return err({
      reason: PRICING_CLIENT_ERROR_REASONS.INVALID_RESPONSE,
      message: 'Scrydex did not return a complete usable price batch',
      isRetryable: true,
    });
  }
}
