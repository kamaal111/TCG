import type { CardsPaginationQuery, CardGame } from './schemas/params.ts';
import type { ImportCard, UpdateCard } from './schemas/payloads.ts';
import type { DeleteCardsResponse, ImportCardsResponse } from './schemas/responses.ts';
import type { CardWithPurchases, CardCollection, CatalogPrinting } from './types.ts';
import type { OwnedCardPriceResponse } from '../card-pricing/schemas/responses.ts';

export type { CardWithPurchases } from './types.ts';

export type ResolvedCSVCard = Omit<ImportCard, 'game' | 'name' | 'set_name' | 'card_number' | 'collection_id'> & {
  printing: CatalogPrinting;
  sourceIndex: number;
};

/** Each mutation is atomic; collection pages and set choices share a snapshot. */
export interface CardRepository {
  listCollection(
    options: CardsPaginationQuery & {
      game?: CardGame;
      setNames: string[];
      illustrators: string[];
      collection_id?: string;
      query?: string;
    },
  ): Promise<CardCollection>;
  get(cardId: string): Promise<CardWithPurchases | undefined>;
  getMany(cardIds: string[]): Promise<CardWithPurchases[]>;
  getArtworkOrigins(cardIds: string[]): Promise<{ id: string; origin?: string }[]>;
  create(values: UpdateCard, printing: CatalogPrinting): Promise<CardWithPurchases>;
  update(cardId: string, values: UpdateCard): Promise<CardWithPurchases | undefined>;
  importCards(inputs: ResolvedCSVCard[]): Promise<ImportCardsResponse>;
  backfillPurchasePrices(cards: CardWithPurchases[], prices: readonly OwnedCardPriceResponse[]): Promise<void>;
  delete(cardIds: string[]): Promise<DeleteCardsResponse>;
}
