import { and, eq, inArray, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';

import { cardListChoices, cardListPredicates } from './card-list-filters.ts';
import { PostgresCardMetadataRepository } from './card-metadata.ts';
import { proxyURLForOriginURL } from '../../card-images/keys.ts';
import { CARD_GAME_MAP } from '../../card-pricing/types.ts';
import { pricedCardMetadata } from '../../card-pricing/utils/pricing.ts';
import { printingKey } from '../../card-pricing/utils/printing-key.ts';
import type { Database } from '../../db/index.ts';
import { cardMetadata, cardPrice, wishlist } from '../../db/schema/index.ts';
import { cursorPage } from '../../utils/pagination.ts';
import type { WishlistRepository } from '../../wishlist/repository.ts';
import type { WishlistQuery } from '../../wishlist/schemas/params.ts';
import { WishlistCardSchema } from '../../wishlist/schemas/responses.ts';
import { encodeWishlistCursor } from '../../wishlist/utils/pagination.ts';
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

  async list({ cursor, game, query, set_name, illustrator }: WishlistQuery, baseURL: string) {
    const savedGame = sql<string>`${wishlist.card}->>'game'`;
    const savedSet = sql<string | null>`${wishlist.card}->>'set_name'`;
    const credit = sql<string | null>`coalesce(${cardMetadata.illustrator}, ${wishlist.card}->>'illustrator')`;

    const filters = cardListPredicates(
      {
        game: savedGame,
        setName: savedSet,
        illustrator: credit,
        name: sql`${wishlist.card}->>'name'`,
        englishSearchAlias: sql`coalesce(${cardMetadata.englishSearchAlias}, ${this.metadata.cachedEnglishSearchAlias(savedPrice)})`,
        cardNumber: sql`${wishlist.card}->>'card_number'`,
      },
      { game, query, setNames: set_name ?? [], illustrators: illustrator ?? [] },
    );

    const ownership = and(eq(wishlist.userId, this.identity.requireUserId()), filters.game);

    const savedPriceId = eq(savedPrice.id, sql`${wishlist.card}->>'id'`);

    const metadataIdentity = and(
      eq(savedGame, CARD_GAME_MAP.POKEMON),
      eq(savedPrice.game, CARD_GAME_MAP.POKEMON),
      eq(cardMetadata.pricingSource, savedPrice.pricingSource),
      eq(cardMetadata.game, savedPrice.game),
      eq(cardMetadata.pricingCardId, savedPrice.pricingCardId),
    );

    return this.db.transaction(
      async tx => {
        const sets = await tx
          .selectDistinct({ name: savedSet })
          .from(wishlist)
          .where(and(ownership, filters.setChoice))
          .orderBy(savedSet);

        const illustrators = await tx
          .selectDistinct({ name: credit })
          .from(wishlist)
          .leftJoin(savedPrice, savedPriceId)
          .leftJoin(cardMetadata, metadataIdentity)
          .where(and(ownership, filters.illustratorChoice(savedGame)))
          .orderBy(credit);

        const rows = await tx
          .select({
            card: wishlist.card,
            illustrator: credit,
            pricingIdentity: {
              pricingSource: savedPrice.pricingSource,
              game: savedPrice.game,
              pricingCardId: savedPrice.pricingCardId,
            },
            printingKey: wishlist.printingKey,
            savedAt: sql<string>`to_char(${wishlist.savedAt}, 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
          })
          .from(wishlist)
          .leftJoin(savedPrice, savedPriceId)
          .leftJoin(cardMetadata, metadataIdentity)
          .where(
            and(
              ownership,
              filters.matches,
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
          entries: page.map(({ card: { originImageURL, ...card }, illustrator, pricingIdentity }) => ({
            card: {
              ...card,
              illustrator: illustrator ?? undefined,
              image_url: originImageURL != null ? proxyURLForOriginURL(originImageURL, baseURL) : undefined,
            },
            pricingIdentity:
              pricingIdentity != null && printingKey(pricingIdentity) === card.printing_key
                ? pricingIdentity
                : undefined,
          })),
          ...cardListChoices(sets, illustrators),
          nextCursor,
        };
      },
      { isolationLevel: 'repeatable read', accessMode: 'read only' },
    );
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
