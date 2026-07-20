import { CARD_CONDITIONS } from '../../db/schema/cards.ts';
import type { CardWithQuantities } from '../repository.ts';
import { CardSchema, type CardResponse } from '../schemas/responses.ts';

const conditionOrder = new Map(CARD_CONDITIONS.map((condition, index) => [condition, index]));

export function serializeCard(card: CardWithQuantities): CardResponse {
  return CardSchema.parse({
    id: card.id,
    game: card.game,
    name: card.name,
    set_name: card.setName,
    card_number: card.cardNumber,
    notes: card.notes,
    quantities: card.quantities
      .map(({ condition, quantity }) => ({ condition, quantity }))
      .toSorted((lhs, rhs) => (conditionOrder.get(lhs.condition) ?? 0) - (conditionOrder.get(rhs.condition) ?? 0)),
    created_at: card.createdAt.toISOString(),
    updated_at: card.updatedAt.toISOString(),
  });
}
