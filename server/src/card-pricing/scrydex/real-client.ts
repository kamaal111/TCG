import { SCRYDEX_FIRST_PAGE, ScrydexClient, type ScrydexClientOptions, type ScrydexRawCard } from '@tcg/scrydex';
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
import { buildScrydexIdBatches, buildScrydexQuery } from './query.ts';

const CATALOG_BATCH_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

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

  async priceCatalogCards(
    game: CardGame,
    providerIds: readonly string[],
  ): Promise<PricingClientResult<PricingSearchResult>> {
    const requestedIds = new Set(providerIds);
    const lookups = this.catalogPriceLookups(requestedIds);
    const cards = new Map<string, ScrydexRawCard>();

    if (lookups == null) {
      return this.invalidPriceBatch();
    }

    for (const { query, ids } of lookups.batches) {
      const result = await this.client.searchCards(game, query, SCRYDEX_FIRST_PAGE);

      if (result.isErr()) {
        return err(result.error);
      }

      if (
        result.value.hasMore ||
        result.value.rejectedCount > 0 ||
        result.value.providerResultCount !== result.value.cards.length ||
        result.value.cards.length !== ids.size
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

    for (const id of lookups.directIds) {
      const result = await this.client.getCardById(game, id);

      if (result.isErr()) {
        return err(result.error);
      }

      if (result.value?.card.id !== id) {
        return this.invalidPriceBatch();
      }

      cards.set(id, result.value.card);
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

  private catalogPriceLookups(providerIds: ReadonlySet<string>) {
    const exactIds: string[] = [];
    const directIds: string[] = [];

    for (const id of providerIds) {
      if (CATALOG_BATCH_ID_PATTERN.test(id)) {
        exactIds.push(id);
      } else {
        directIds.push(id);
      }
    }

    const batches = buildScrydexIdBatches(exactIds);

    return batches != null ? { batches, directIds } : undefined;
  }

  private invalidPriceBatch(): PricingClientResult<PricingSearchResult> {
    return err({
      reason: PRICING_CLIENT_ERROR_REASONS.INVALID_RESPONSE,
      message: 'Scrydex did not return a complete usable price batch',
      isRetryable: true,
    });
  }
}
