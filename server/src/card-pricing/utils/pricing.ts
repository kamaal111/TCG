import { toISO8601String } from '../../utils/strings.ts';
import type { CardPriceRow } from '../repository.ts';
import { PRICE_HEADLINE_METRICS, type PricedCardResponse, PricedCardSchema } from '../schemas/responses.ts';
import type { CardGame } from '../types.ts';

export function serializePricedCard(game: CardGame, row: CardPriceRow): PricedCardResponse {
  const market =
    row.prices.market != null
      ? {
          condition: row.prices.market.condition,
          currency: row.prices.market.currency,
          low: row.prices.market.low,
          market: row.prices.market.market,
          trend_7d:
            row.prices.market.trend7d == null
              ? undefined
              : {
                  price_change: row.prices.market.trend7d.priceChange,
                  percent_change: row.prices.market.trend7d.percentChange,
                },
          trend_30d:
            row.prices.market.trend30d == null
              ? undefined
              : {
                  price_change: row.prices.market.trend30d.priceChange,
                  percent_change: row.prices.market.trend30d.percentChange,
                },
        }
      : undefined;
  const headline =
    market?.low != null
      ? {
          amount: market.low,
          currency: market.currency,
          metric: PRICE_HEADLINE_METRICS.LOWEST_NEAR_MINT,
        }
      : undefined;

  return PricedCardSchema.parse({
    id: row.id,
    game,
    name: row.name,
    card_number: row.cardNumber,
    rarity: row.prices.rarity,
    image_url: row.prices.image,
    headline,
    market,
    priced_on: `${row.pricedOn}T00:00:00.000Z`,
    fetched_at: toISO8601String(row.fetchedAt),
  });
}
