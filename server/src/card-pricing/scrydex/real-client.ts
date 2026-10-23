import { ScrydexClient, type ScrydexClientOptions } from '@tcg/scrydex';
import { err, ok } from 'neverthrow';

import {
  type PricingClient,
  type PricingClientResult,
  PRICING_CLIENT_ERROR_REASONS,
  type PricingSearchResult,
} from '../client.ts';
import type { CardLanguage } from '../languages.ts';
import { type CardGame, type PricingCardRecord, PRICING_SOURCES } from '../types.ts';
import { normalizeScrydexCard } from './normalize.ts';
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
    languages: readonly CardLanguage[] = [],
  ): Promise<PricingClientResult<PricingSearchResult>> {
    const result = await this.client.searchCards(game, buildScrydexQuery(game, query, languages));

    if (result.isErr()) {
      return err(result.error);
    }

    const records: PricingCardRecord[] = [];
    let rejectedCount = result.value.rejectedCount;
    let missingBaseVariantCount = 0;

    for (const raw of result.value.cards) {
      const normalized = normalizeScrydexCard(game, raw);

      if (normalized == null) {
        rejectedCount += 1;
        continue;
      }

      if (!normalized.hasBaseVariant) {
        missingBaseVariantCount += 1;
      }

      records.push({ card: normalized.card, raw });
    }

    return ok({
      records,
      providerResultCount: result.value.providerResultCount,
      rejectedCount,
      missingBaseVariantCount,
    });
  }

  async getCardById(game: CardGame, id: string): Promise<PricingClientResult<PricingCardRecord | null>> {
    const result = await this.client.getCardById(game, id);

    if (result.isErr()) {
      return err(result.error);
    }

    if (result.value == null) {
      return ok(null);
    }

    const normalized = normalizeScrydexCard(game, result.value.card);

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
