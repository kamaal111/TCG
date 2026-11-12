import type { Collection } from '../../collections/schemas/responses.ts';
import type { binderPage, binderSlot, cardCollection } from '../../db/schema/cards.ts';

export function serializeCollectionLayout(
  collection: typeof cardCollection.$inferSelect,
  pages: readonly (typeof binderPage.$inferSelect)[],
  slotsByPage: ReadonlyMap<string, readonly (typeof binderSlot.$inferSelect)[]>,
): Collection {
  return {
    id: collection.id,
    name: collection.name,
    is_unfiled: collection.isUnfiled,
    columns: collection.columns,
    rows: collection.rows,
    revision: collection.revision,
    pages: pages.map(page => ({
      id: page.id,
      slots: (slotsByPage.get(page.id) ?? []).map(slot => ({
        row: slot.row,
        column: slot.column,
        card_id: slot.cardId,
        quantity: slot.quantity,
      })),
    })),
  };
}
