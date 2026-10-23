import type { CardsPaginationQuery, CardGame } from './schemas/params.ts';
import type { ImportCard, UpsertCard } from './schemas/payloads.ts';
import type { DeleteCardsResponse, ImportCardsResponse } from './schemas/responses.ts';
import type { CardWithPurchases, CardCollection } from './types.ts';
import type { OwnedCardPriceResponse } from '../card-pricing/schemas/responses.ts';

export type { CardWithPurchases } from './types.ts';

/** Each mutation is atomic; collection pages and set choices share a snapshot. */
export interface CardRepository {
  listCollection(options: CardsPaginationQuery & { game?: CardGame; setNames: string[] }): Promise<CardCollection>;
  get(cardId: string): Promise<CardWithPurchases | undefined>;
  create(values: UpsertCard): Promise<CardWithPurchases>;
  update(cardId: string, values: UpsertCard): Promise<CardWithPurchases | undefined>;
  importCards(inputs: ImportCard[]): Promise<ImportCardsResponse>;
  backfillPurchasePrices(cards: CardWithPurchases[], prices: readonly OwnedCardPriceResponse[]): Promise<void>;
  delete(cardIds: string[]): Promise<DeleteCardsResponse>;
}
