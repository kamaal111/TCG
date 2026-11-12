import type { CardWithPurchases } from './types.ts';
import type { CardPriceRow } from '../card-pricing/repository.ts';
import type { Collection } from '../collections/schemas/responses.ts';

export interface OfflineCollectionIDs {
  cards: string[];
  collections: string[];
}

export interface OfflineCollectionRepository {
  read(ids: OfflineCollectionIDs | undefined): Promise<{
    cards: { owned: CardWithPurchases; price?: CardPriceRow | null }[];
    collections: Collection[];
  }>;
}
