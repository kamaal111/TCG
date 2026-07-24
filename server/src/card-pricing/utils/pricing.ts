import type { CardGame } from '../tcggo/types.ts';
import type { CardPriceRow } from '../repository.ts';
import { PricedCardSchema, type PricedCardResponse } from '../schemas/responses.ts';

export function serializePricedCard(game: CardGame, row: CardPriceRow): PricedCardResponse {
  const cardmarket = row.prices.cardmarket;
  const tcgplayer = row.prices.tcgplayer;
  const lowestNearMint = cardmarket?.lowestNearMint;
  const headlineCurrency = cardmarket?.currency;

  return PricedCardSchema.parse({
    tcggo_card_id: row.tcggoCardId,
    game,
    name: row.name,
    card_number: row.cardNumber,
    rarity: row.prices.rarity,
    image_url: row.prices.image,
    headline:
      lowestNearMint == null || headlineCurrency == null
        ? undefined
        : { amount: lowestNearMint, currency: headlineCurrency, metric: 'lowest_near_mint' },
    cardmarket:
      cardmarket == null
        ? undefined
        : {
            currency: cardmarket.currency,
            lowest_near_mint: cardmarket.lowestNearMint,
            average_7d: cardmarket.average7d,
            average_30d: cardmarket.average30d,
            trend: priceTrend(cardmarket.average7d, cardmarket.average30d),
          },
    tcgplayer:
      tcgplayer == null
        ? undefined
        : {
            currency: tcgplayer.currency,
            market_price: tcgplayer.marketPrice,
            mid_price: tcgplayer.midPrice,
          },
    priced_on: row.pricedOn,
    fetched_at: row.fetchedAt.toISOString(),
  });
}

function priceTrend(average7d: number | undefined, average30d: number | undefined): 'up' | 'down' | 'flat' | undefined {
  if (average7d == null || average30d == null) return undefined;
  if (average7d > average30d) return 'up';
  if (average7d < average30d) return 'down';
  return 'flat';
}
