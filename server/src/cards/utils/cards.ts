import { purchasePriceChangePercent } from './purchase-price.ts';
import type { OwnedCardPriceResponse } from '../../card-pricing/schemas/responses.ts';
import type { ForexSnapshot } from '../../forex/schemas/responses.ts';
import { toISO8601String } from '../../utils/strings.ts';
import type { CardWithPurchases } from '../repository.ts';
import type { CardResponse, CardWithPriceResponse } from '../schemas/responses.ts';

export function serializeCard(card: CardWithPurchases): CardResponse {
  return serializeCardFields(card);
}

export function serializeCardWithPrice(
  card: CardWithPurchases,
  price: OwnedCardPriceResponse,
  snapshot?: ForexSnapshot,
): CardWithPriceResponse {
  return {
    ...serializeCardFields(card),
    purchase_price_change_percent: purchasePriceChangePercent(
      card.purchaseBatches,
      price.priced_card?.market,
      snapshot,
    ),
    price,
  };
}

function serializeCardFields(card: CardWithPurchases): CardResponse {
  return {
    id: card.id,
    game: card.game,
    name: card.name,
    set_name: card.setName,
    card_number: card.cardNumber,
    notes: card.notes,
    purchases: card.purchaseBatches.map(batch => ({
      id: batch.id,
      condition: batch.condition,
      quantity: batch.quantity,
      purchase_price: batch.purchasePrice,
      currency: batch.currency,
      automatic_price_date: batch.automaticPriceDate,
    })),
    purchase_price_change_percent: null,
    created_at: toISO8601String(card.createdAt),
    updated_at: toISO8601String(card.updatedAt),
  };
}
