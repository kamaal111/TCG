import { and, eq, ilike, inArray, or, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';

import { PostgresCardMetadataRepository } from './card-metadata.ts';
import { proxyURLForOriginURL } from '../../card-images/keys.ts';
import { CARD_GAME_MAP } from '../../card-pricing/types.ts';
import { pricedCardMetadata } from '../../card-pricing/utils/pricing.ts';
import type { Database } from '../../db/index.ts';
import { cardMetadata, cardPrice, wishlist } from '../../db/schema/index.ts';
import { cursorPage } from '../../utils/pagination.ts';
import { literalSubstringPattern } from '../../utils/search.ts';
import type { WishlistRepository } from '../../wishlist/repository.ts';
import { WishlistCardSchema } from '../../wishlist/schemas/responses.ts';
import { encodeWishlistCursor, type WishlistCursor } from '../../wishlist/utils/pagination.ts';
import type { AuthenticatedIdentity } from '../contracts.ts';

const PAGE_SIZE = 50;
const savedPrice = alias(cardPrice, 'saved_price');

export class PostgresWishlistRepository implements WishlistRepository {
  private readonly db: Database;
  private readonly metadata: PostgresCardMetadataRepository;
  private readonly identity: AuthenticatedIdentity;

  constructor(db: Database, identity: AuthenticatedIdentity) {
    this.db = db;
    this.metadata = new PostgresCardMetadataRepository(db, identity);
    this.identity = identity;
  }

  async list(cursor: WishlistCursor | undefined, baseURL: string, query?: string) {
    const pattern = query !== undefined ? literalSubstringPattern(query) : undefined;

    const list = this.db
      .select({
        card: wishlist.card,
        printingKey: wishlist.printingKey,
        savedAt: sql<string>`to_char(${wishlist.savedAt}, 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
      })
      .from(wishlist);

    const search =
      pattern === undefined
        ? list
        : list
            .leftJoin(
              savedPrice,
              and(eq(savedPrice.id, sql`${wishlist.card}->>'id'`), eq(savedPrice.game, CARD_GAME_MAP.POKEMON)),
            )
            .leftJoin(
              cardMetadata,
              and(
                eq(cardMetadata.pricingSource, savedPrice.pricingSource),
                eq(cardMetadata.game, savedPrice.game),
                eq(cardMetadata.pricingCardId, savedPrice.pricingCardId),
              ),
            );

    const rows = await search
      .where(
        and(
          eq(wishlist.userId, this.identity.requireUserId()),
          pattern !== undefined
            ? or(
                ilike(sql`${wishlist.card}->>'name'`, pattern),
                ilike(sql`${wishlist.card}->>'set_name'`, pattern),
                ilike(sql`${wishlist.card}->>'card_number'`, pattern),
                ilike(
                  sql`coalesce(${cardMetadata.englishSearchAlias}, ${this.metadata.cachedEnglishSearchAlias(savedPrice)})`,
                  pattern,
                ),
              )
            : undefined,
          cursor != null
            ? sql`(${wishlist.savedAt}, ${wishlist.printingKey}) < (${cursor.savedAt}::timestamp, ${cursor.printingKey})`
            : undefined,
        ),
      )
      .orderBy(sql`${wishlist.savedAt} desc nulls last`, sql`${wishlist.printingKey} desc nulls last`)
      .limit(PAGE_SIZE + 1);

    const { page, nextCursor } = cursorPage(rows, PAGE_SIZE, row => {
      return encodeWishlistCursor({ savedAt: row.savedAt, printingKey: row.printingKey });
    });

    return {
      entries: page.map(({ card: { originImageURL, ...card } }) => ({
        ...card,
        image_url: originImageURL != null ? proxyURLForOriginURL(originImageURL, baseURL) : undefined,
      })),
      next_cursor: nextCursor,
    };
  }

  async savedPrintingKeys(printingKeys: readonly string[]): Promise<ReadonlySet<string>> {
    const userId = this.identity.requireUserId();
    const keys = [...new Set(printingKeys)];

    if (keys.length === 0) {
      return new Set();
    }

    const rows = await this.db
      .select({ printingKey: wishlist.printingKey })
      .from(wishlist)
      .where(and(eq(wishlist.userId, userId), inArray(wishlist.printingKey, keys)));

    return new Set(rows.map(row => row.printingKey));
  }

  async save(pricedCardId: string): Promise<boolean> {
    const userId = this.identity.requireUserId();
    const [pricedCard] = await this.db.select().from(cardPrice).where(eq(cardPrice.id, pricedCardId)).limit(1);

    if (pricedCard == null) {
      return false;
    }

    const card = WishlistCardSchema.parse(pricedCardMetadata(pricedCard));
    await this.db
      .insert(wishlist)
      .values({ userId, printingKey: card.printing_key, card: { ...card, originImageURL: pricedCard.prices.image } })
      .onConflictDoNothing({ target: [wishlist.userId, wishlist.printingKey] });

    return true;
  }

  async remove(printingKey: string): Promise<void> {
    await this.db.delete(wishlist).where(this.ownedPrinting(printingKey));
  }

  private ownedPrinting(printingKey: string) {
    return and(eq(wishlist.userId, this.identity.requireUserId()), eq(wishlist.printingKey, printingKey));
  }
}
