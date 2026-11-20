import type { CardPriceRow } from '../card-pricing/types.ts';
import type { WishlistCard } from './schemas/responses.ts';
import type { WishlistCursor } from './utils/pagination.ts';

export interface WishlistEntry {
  card: WishlistCard;
  pricingIdentity?: Pick<CardPriceRow, 'pricingSource' | 'game' | 'pricingCardId'>;
}

export interface WishlistRepository {
  list(
    cursor: WishlistCursor | undefined,
    baseURL: string,
    query?: string,
  ): Promise<{
    entries: WishlistEntry[];
    next_cursor: string | null;
  }>;
  savedPrintingKeys(printingKeys: readonly string[]): Promise<ReadonlySet<string>>;
  save(pricedCardId: string): Promise<boolean>;
  remove(printingKey: string): Promise<void>;
}
