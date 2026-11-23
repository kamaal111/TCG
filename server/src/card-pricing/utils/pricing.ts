import { ScrydexRawCardSchema } from '@tcg/scrydex';

import { resolveConditionValues } from './conditions.ts';
import { readEnglishSearchAlias } from './english-search-alias.ts';
import { cachedIllustrator } from './illustrator.ts';
import { printingKey } from './printing-key.ts';
import { proxyURLForOriginURL } from '../../card-images/keys.ts';
import { CARD_CONDITION_MAP } from '../../cards/types.ts';
import { toISO8601String } from '../../utils/strings.ts';
import type { CardPriceRow } from '../repository.ts';
import {
  OWNED_CARD_PRICE_STATUSES,
  type OwnedCardPriceResponse,
  PRICE_HEADLINE_METRICS,
  type PricedCardResponse,
  PricedCardSchema,
} from '../schemas/responses.ts';
import { normalizeScrydexLookup, splitScrydexPricingId } from '../scrydex/normalize.ts';
import { type CardGame, isScrydexPricingSource, type NormalizedConditionPrice } from '../types.ts';

export function serializePricedCard(game: CardGame, row: CardPriceRow, baseURL: string): PricedCardResponse {
  const quotes = cachedConditionPrices(row);
  const conditionPrices = quotes.map(serializeConditionPrice);
  const nearMint = quotes.find(quote => quote.condition === CARD_CONDITION_MAP.NEAR_MINT);

  const market =
    nearMint != null ? { ...serializeConditionPrice(nearMint), condition: CARD_CONDITION_MAP.NEAR_MINT } : undefined;

  const headline =
    market?.low != null
      ? {
          amount: market.low,
          currency: market.currency,
          metric: PRICE_HEADLINE_METRICS.LOWEST_NEAR_MINT,
        }
      : undefined;

  const imageUrl = row.prices.image != null ? proxyURLForOriginURL(row.prices.image, baseURL) : undefined;

  return PricedCardSchema.parse({
    ...pricedCardMetadata(row),
    game,
    image_url: imageUrl,
    headline,
    market,
    condition_prices: conditionPrices,
    condition_values: resolveConditionValues(conditionPrices),
  });
}

export function serializeOwnedCardPrice(cardId: string, price: PricedCardResponse): OwnedCardPriceResponse {
  return {
    card_id: cardId,
    status: price.condition_values?.length ? OWNED_CARD_PRICE_STATUSES.PRICED : OWNED_CARD_PRICE_STATUSES.NO_PRICE,
    priced_card: price,
  };
}

function serializeConditionPrice(quote: NormalizedConditionPrice) {
  return {
    condition: quote.condition,
    currency: quote.currency,
    low: quote.low,
    market: quote.market,
    trend_7d:
      quote.trend7d != null
        ? { price_change: quote.trend7d.priceChange, percent_change: quote.trend7d.percentChange }
        : undefined,
    trend_30d:
      quote.trend30d != null
        ? { price_change: quote.trend30d.priceChange, percent_change: quote.trend30d.percentChange }
        : undefined,
  };
}

function cachedConditionPrices(row: CardPriceRow): readonly NormalizedConditionPrice[] {
  if (row.prices.conditionPrices != null) {
    return row.prices.conditionPrices;
  }

  const legacy = row.prices.market == null ? [] : [row.prices.market];

  if (!isScrydexPricingSource(row.pricingSource)) {
    return legacy;
  }

  const raw = ScrydexRawCardSchema.safeParse(row.raw);

  if (!raw.success) {
    return legacy;
  }

  const { providerId, variantName } = splitScrydexPricingId(row.game, row.pricingCardId);
  const recovered = normalizeScrydexLookup(row.game, raw.data, variantName)?.card;

  const prices =
    recovered?.id === row.pricingCardId && String(raw.data.id) === providerId
      ? (recovered.pricing.conditionPrices ?? [])
      : [];

  return prices.some(price => price.condition === CARD_CONDITION_MAP.NEAR_MINT) ? prices : [...legacy, ...prices];
}

export function pricedCardMetadata(row: CardPriceRow) {
  return {
    id: row.id,
    printing_key: printingKey(row),
    game: row.game,
    name: row.name,
    set_name: row.prices.setName,
    card_number: row.cardNumber,
    rarity: row.prices.rarity,
    variant_name: row.prices.variantName,
    illustrator: cachedIllustrator(row),
    english_search_alias: readEnglishSearchAlias(row),
    priced_on: `${row.pricedOn}T00:00:00.000Z`,
    fetched_at: toISO8601String(row.fetchedAt),
  };
}
