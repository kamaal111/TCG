import { purchasePriceChangePercent } from './purchase-price.ts';
import type { OwnedCardPriceResponse } from '../../card-pricing/schemas/responses.ts';
import { toISO8601String } from '../../utils/strings.ts';
import type { CardWithPurchases } from '../repository.ts';
import {
  type CardResponse,
  CardSchema,
  type CardWithPriceResponse,
  CardWithPriceSchema,
} from '../schemas/responses.ts';

export function serializeCard(card: CardWithPurchases): CardResponse {
  return CardSchema.parse(serializeCardFields(card));
}

export function serializeCardWithPrice(card: CardWithPurchases, price: OwnedCardPriceResponse): CardWithPriceResponse {
  return CardWithPriceSchema.parse({
    ...serializeCardFields(card),
    purchase_price_change_percent: purchasePriceChangePercent(card.purchaseBatches, price.priced_card?.market),
    price,
  });
}

function serializeCardFields(card: CardWithPurchases) {
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
