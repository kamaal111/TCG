import { InternalServerError } from '@tcg/http/exceptions';

import { CARD_GAME_MAP } from '../src/card-pricing/types.ts';
import type { SQLiteCardCatalog } from '../src/persistence/sqlite/card-catalog.ts';

export function verifyReleaseSetInventory(catalog: SQLiteCardCatalog): void {
  for (const game of Object.values(CARD_GAME_MAP)) {
    const inventory = catalog.setInventory(game);

    if (inventory == null || inventory.printings.length === 0) {
      throw new InternalServerError(undefined, {
        diagnosticMessage: `Card catalog is missing set checklist data for ${game}`,
      });
    }
  }
}
