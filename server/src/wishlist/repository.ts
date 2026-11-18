import type { WishlistCard } from './schemas/responses.ts';
import type { WishlistCursor } from './utils/pagination.ts';

export interface WishlistRepository {
  list(
    cursor: WishlistCursor | undefined,
    baseURL: string,
    query?: string,
  ): Promise<{
    entries: WishlistCard[];
    next_cursor: string | null;
  }>;
  savedPrintingKeys(printingKeys: readonly string[]): Promise<ReadonlySet<string>>;
  save(pricedCardId: string): Promise<boolean>;
  remove(printingKey: string): Promise<void>;
}
