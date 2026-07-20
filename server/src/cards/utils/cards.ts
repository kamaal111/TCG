import { CARD_CONDITIONS } from '../../db/schema/cards.ts';
import { toISO8601String } from '../../utils/strings.ts';
import type { CardWithQuantities } from '../repository.ts';
import type { Card } from '../schemas/responses.ts';

export function serializeCard(cardWithQuantities: CardWithQuantities): Card {
  const sortedQuantities = cardWithQuantities.quantities.toSorted(
    (a, b) => CARD_CONDITIONS.indexOf(a.condition) - CARD_CONDITIONS.indexOf(b.condition),
  );

  return {
    id: cardWithQuantities.id,
    game: cardWithQuantities.game,
    name: cardWithQuantities.name,
    set_name: cardWithQuantities.setName,
    card_number: cardWithQuantities.cardNumber,
    notes: cardWithQuantities.notes,
    quantities: sortedQuantities.map(quantity => ({
      condition: quantity.condition,
      quantity: quantity.quantity,
    })),
    created_at: toISO8601String(cardWithQuantities.createdAt),
    updated_at: toISO8601String(cardWithQuantities.updatedAt),
  };
}
