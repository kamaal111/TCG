import { and, desc, eq, inArray, isNotNull, sql, type SQLWrapper } from 'drizzle-orm';

import { CARD_GAME_MAP, isScrydexPricingSource, SCRYDEX_PRICING_SOURCES } from '../../card-pricing/types.ts';
import type { CardWithPurchases } from '../../cards/types.ts';
import type { Database } from '../../db/index.ts';
import { cardPrice } from '../../db/schema/card-pricing.ts';
import { card, cardMetadata } from '../../db/schema/cards.ts';
import type { AuthenticatedIdentity } from '../contracts.ts';

type PrintingIdentity = Record<'pricingSource' | 'game' | 'pricingCardId', SQLWrapper>;

const translationPath = sql`'{translation,en,name}'`;

const cachedEnglishName = sql<string | null>`case
  when jsonb_typeof(${cardPrice.raw} #> ${translationPath}) = 'string'
  then nullif(regexp_replace(${cardPrice.raw} #>> ${translationPath}, '^[[:space:]]+|[[:space:]]+$', '', 'g'), '')
end`;

export class PostgresCardMetadataRepository {
  private readonly db: Database;
  private readonly identity: AuthenticatedIdentity;

  constructor(db: Database, identity: AuthenticatedIdentity) {
    this.db = db;
    this.identity = identity;
  }

  cachedEnglishSearchAlias(printing: PrintingIdentity) {
    return sql<string | null>`(${this.latestCachedEnglishName(printing)})`;
  }

  private latestCachedEnglishName(printing: PrintingIdentity) {
    return this.db
      .select({ name: cachedEnglishName.as('english_search_alias') })
      .from(cardPrice)
      .where(
        and(
          eq(printing.game, CARD_GAME_MAP.POKEMON),
          inArray(printing.pricingSource, SCRYDEX_PRICING_SOURCES),
          eq(cardPrice.pricingSource, printing.pricingSource),
          eq(cardPrice.game, printing.game),
          eq(cardPrice.pricingCardId, printing.pricingCardId),
          isNotNull(cachedEnglishName),
        ),
      )
      .orderBy(desc(cardPrice.pricedOn))
      .limit(1);
  }

  async backfillEnglishSearchAliases(cards: CardWithPurchases[]) {
    const candidateIds = cards.flatMap(({ id, game, englishSearchAlias, pricingSource, pricingCardId }) => {
      return game === CARD_GAME_MAP.POKEMON &&
        englishSearchAlias == null &&
        isScrydexPricingSource(pricingSource) &&
        pricingCardId != null
        ? [id]
        : [];
    });

    if (candidateIds.length === 0) {
      return cards;
    }

    const printings = this.db
      .selectDistinct({
        pricingSource: card.pricingSource,
        game: card.game,
        pricingCardId: card.pricingCardId,
      })
      .from(card)
      .where(and(eq(card.userId, this.identity.requireUserId()), inArray(card.id, candidateIds)))
      .as('printings');

    const cached = this.latestCachedEnglishName(printings).as('cached_english_name');

    const aliasesToInsert = this.db
      .select({
        pricingSource: printings.pricingSource,
        game: printings.game,
        pricingCardId: printings.pricingCardId,
        englishSearchAlias: cached.name,
      })
      .from(printings)
      .crossJoinLateral(cached)
      .orderBy(printings.pricingSource, printings.pricingCardId);

    const written = await this.db
      .insert(cardMetadata)
      .select(aliasesToInsert)
      .onConflictDoUpdate({
        target: [cardMetadata.pricingSource, cardMetadata.game, cardMetadata.pricingCardId],
        set: {
          englishSearchAlias: sql`coalesce(${cardMetadata.englishSearchAlias}, excluded.english_search_alias)`,
          updatedAt: sql`case when ${cardMetadata.englishSearchAlias} is null then now() else ${cardMetadata.updatedAt} end`,
        },
      })
      .returning({
        pricingSource: cardMetadata.pricingSource,
        pricingCardId: cardMetadata.pricingCardId,
        englishSearchAlias: cardMetadata.englishSearchAlias,
      });

    const key = (source: string | null, printing: string | null) => JSON.stringify([source, printing]);
    const aliases = new Map(written.map(row => [key(row.pricingSource, row.pricingCardId), row.englishSearchAlias]));

    return cards.map(card => {
      const alias = aliases.get(key(card.pricingSource, card.pricingCardId));

      return card.game === CARD_GAME_MAP.POKEMON && card.englishSearchAlias == null && alias != null
        ? { ...card, englishSearchAlias: alias }
        : card;
    });
  }
}
