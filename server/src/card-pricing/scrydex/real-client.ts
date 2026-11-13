import { ScrydexClient, type ScrydexClientOptions } from '@tcg/scrydex';
import { err, ok } from 'neverthrow';

import {
  type PricingClient,
  type PricingClientResult,
  PRICING_CLIENT_ERROR_REASONS,
  type PricingSearchResult,
} from '../client.ts';
import { type CardGame, type PricingCardRecord, type PricingSearchOptions, PRICING_SOURCES } from '../types.ts';
import { normalizeScrydexLookup, normalizeScrydexSearch, splitScrydexPricingId } from './normalize.ts';
import { buildScrydexQuery } from './query.ts';

export class RealScrydexClient implements PricingClient {
  readonly source = PRICING_SOURCES.SCRYDEX_REAL;
  private readonly client: ScrydexClient;

  constructor(options: ScrydexClientOptions = {}) {
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
}
