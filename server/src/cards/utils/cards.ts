import type { OwnedCardPriceResponse } from '../../card-pricing/schemas/responses.ts';
import { CARD_CONDITIONS } from '../../db/schema/cards.ts';
import { toISO8601String } from '../../utils/strings.ts';
import type { CardWithQuantities } from '../repository.ts';
import {
  type CardResponse,
  CardSchema,
  type CardWithPriceResponse,
  CardWithPriceSchema,
} from '../schemas/responses.ts';

const conditionOrder = new Map(CARD_CONDITIONS.map((condition, index) => [condition, index]));

export function serializeCard(card: CardWithQuantities): CardResponse {
  return CardSchema.parse(serializeCardFields(card));
}

export function serializeCardWithPrice(card: CardWithQuantities, price: OwnedCardPriceResponse): CardWithPriceResponse {
  return CardWithPriceSchema.parse({ ...serializeCardFields(card), price });
}

function serializeCardFields(card: CardWithQuantities) {
  const quantities = card.quantities
    .map(({ condition, quantity }) => ({ condition, quantity }))
    .toSorted((lhs, rhs) => (conditionOrder.get(lhs.condition) ?? 0) - (conditionOrder.get(rhs.condition) ?? 0));

  return {
    id: card.id,
    game: card.game,
    name: card.name,
    set_name: card.setName,
    card_number: card.cardNumber,
    notes: card.notes,
    quantities,
    created_at: toISO8601String(card.createdAt),
    updated_at: toISO8601String(card.updatedAt),
  };
}
