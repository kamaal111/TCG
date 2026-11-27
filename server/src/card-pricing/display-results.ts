import type { PricedCardResponse } from './schemas/responses.ts';
import type { CardGame } from './types.ts';
import type { HonoContext } from '../context.ts';
import { displayPricedCard, type ForexDisplayContext } from '../forex/display.ts';
import { setChecklists } from '../sets/checklist.ts';

export async function displayPricingResults(
  c: HonoContext,
  game: CardGame,
  matches: readonly PricedCardResponse[],
  display: ForexDisplayContext,
) {
  const keys = matches.flatMap(card => (card.printing_key != null ? [card.printing_key] : []));
  const savedKeys = await c.get('wishlistRepository').savedPrintingKeys(keys);

  const inventory = c.get('cardCatalog')?.setInventory(game);
  const checklists = inventory != null ? setChecklists(inventory) : undefined;

  return matches.map(card => ({
    ...displayPricedCard(card, display),
    catalog_sets: card.printing_key != null ? checklists?.memberships(card.printing_key) : undefined,
    is_wishlisted: card.printing_key != null && savedKeys.has(card.printing_key),
  }));
}
