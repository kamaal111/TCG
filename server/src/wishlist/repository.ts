import type { WishlistQuery } from './schemas/params.ts';
import type { WishlistCard } from './schemas/responses.ts';
import type { CardPriceRow } from '../card-pricing/types.ts';
import type { CardListPageInfo } from '../cards/list-page.ts';

export interface WishlistEntry {
  card: WishlistCard;
  pricingIdentity?: Pick<CardPriceRow, 'pricingSource' | 'game' | 'pricingCardId'>;
}

export interface WishlistRepository {
  list(query: WishlistQuery, baseURL: string): Promise<CardListPageInfo & { entries: WishlistEntry[] }>;
  savedPrintingKeys(printingKeys: readonly string[]): Promise<ReadonlySet<string>>;
  save(pricedCardId: string): Promise<boolean>;
  remove(printingKey: string): Promise<void>;
}
