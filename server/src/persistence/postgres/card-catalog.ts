import crypto from 'node:crypto';

import { and, arrayContains, arrayOverlaps, desc, eq, gt, inArray, isNull, lt, or, sql, type SQL } from 'drizzle-orm';

import {
  CATALOG_IDENTIFIER_FIELD_MAP,
  type buildCatalogQuery,
  type CatalogIdentifier,
} from '../../card-pricing/catalog-query.ts';
import type { CardCatalogRepository, CatalogPrintingRow } from '../../card-pricing/catalog-repository.ts';
import type { CardLanguage } from '../../card-pricing/languages.ts';
import type { CardGame, PricingSource } from '../../card-pricing/types.ts';
import { CATALOG_PAGE_SIZE } from '../../card-pricing/utils/pagination.ts';
import { ONE_DAY_IN_HOURS } from '../../constants/time.ts';
import type { Database } from '../../db/index.ts';
import { cardCatalogGeneration, cardCatalogPrinting, cardCatalogTermsVector } from '../../db/schema/card-catalog.ts';

const INSERT_BATCH_SIZE = 500;
const RETIRED_CATALOG_RETENTION_DAYS = 2;
const RETIRED_CATALOG_RETENTION_HOURS = RETIRED_CATALOG_RETENTION_DAYS * ONE_DAY_IN_HOURS;
const CATALOG_RETENTION_CUTOFF = sql`now() - make_interval(hours => ${RETIRED_CATALOG_RETENTION_HOURS})`;
const ADVISORY_LOCK_HASH_SEED = 0;
const MIN_CATALOG_PREFIX_LENGTH = 2;
const CATALOG_PREFIX_LENGTH_PATTERN = new RegExp(`^.{${MIN_CATALOG_PREFIX_LENGTH}}`, 'u');
const CATALOG_PAGE_LOOKAHEAD = 1;

const CATALOG_MATCH_RANK = {
  EXACT_IDENTIFIER: 0,
  EXACT_NAME: 1,
  EXACT_TERMS: 2,
  PREFIX: 3,
} as const;

type Generation = typeof cardCatalogGeneration.$inferSelect;

export class PostgresCardCatalog implements CardCatalogRepository {
  private readonly db: Database;
  private readonly source: PricingSource;

  constructor(db: Database, source: PricingSource) {
    this.db = db;
    this.source = source;
  }

  async generation(game: CardGame, id: string | undefined): Promise<Generation | undefined> {
    const selection =
      id == null
        ? isNull(cardCatalogGeneration.supersededAt)
        : and(
            eq(cardCatalogGeneration.id, id),
            or(
              isNull(cardCatalogGeneration.supersededAt),
              gt(cardCatalogGeneration.supersededAt, CATALOG_RETENTION_CUTOFF),
            ),
          );

    const [generation] = await this.db
      .select()
      .from(cardCatalogGeneration)
      .where(and(eq(cardCatalogGeneration.source, this.source), eq(cardCatalogGeneration.game, game), selection));

    return generation;
  }

  async withBuildLock(game: CardGame, operation: () => Promise<void>): Promise<boolean> {
    const connection = await this.db.$client.connect();
    const key = `card-catalog:${this.source}:${game}`;
    let reusable = false;

    try {
      const { rows } = await connection.query<{ acquired: boolean }>(
        'select pg_try_advisory_lock(hashtextextended($1, $2)) as acquired',
        [key, ADVISORY_LOCK_HASH_SEED],
      );

      if (!rows[0]?.acquired) {
        reusable = true;

        return false;
      }

      await Promise.resolve()
        .then(operation)
        .finally(async () => {
          const unlocked = await connection.query<{ released: boolean }>(
            'select pg_advisory_unlock(hashtextextended($1, $2)) as released',
            [key, ADVISORY_LOCK_HASH_SEED],
          );

          reusable = unlocked.rows[0]?.released === true;
        });

      return true;
    } finally {
      connection.release(!reusable);
    }
  }

  async publish(game: CardGame, printings: readonly CatalogPrintingRow[]): Promise<void> {
    const generation = crypto.randomUUID();

    await this.db.transaction(async tx => {
      const scope = and(eq(cardCatalogGeneration.source, this.source), eq(cardCatalogGeneration.game, game));
      await tx
        .update(cardCatalogGeneration)
        .set({ supersededAt: sql`now()` })
        .where(and(scope, isNull(cardCatalogGeneration.supersededAt)));
      await tx.insert(cardCatalogGeneration).values({
        id: generation,
        source: this.source,
        game,
        printingCount: printings.length,
      });

      for (let start = 0; start < printings.length; start += INSERT_BATCH_SIZE) {
        const batch = printings.slice(start, start + INSERT_BATCH_SIZE);

        await tx.insert(cardCatalogPrinting).values(batch.map(printing => ({ generation, ...printing })));
      }

      await tx
        .delete(cardCatalogGeneration)
        .where(and(scope, lt(cardCatalogGeneration.supersededAt, CATALOG_RETENTION_CUTOFF)));
    });
  }

  async search(
    generation: string,
    query: ReturnType<typeof buildCatalogQuery>,
    languages: readonly CardLanguage[],
    offset: number,
  ) {
    const printing = cardCatalogPrinting;
    const vector = cardCatalogTermsVector(printing);
    const identifierConditions = or(...query.identifiers.map(identifier => this.identifierCondition(identifier)));

    const identifierMatch =
      identifierConditions != null
        ? and(identifierConditions, this.matches(vector, query.identifierTerms, false))
        : sql`false`;

    const textMatch = query.requireIdentifier ? sql`false` : this.matches(vector, query.terms, true);
    const exactMatch = this.matches(vector, query.terms, false);
    const exactName = arrayContains(printing.names, [query.terms.join(' ')]);
    const selectedLanguages = languages.length > 0 ? inArray(printing.language, languages) : undefined;

    const tier = sql<number>`
      case
        when ${identifierMatch} then ${CATALOG_MATCH_RANK.EXACT_IDENTIFIER}
        when ${exactName} then ${CATALOG_MATCH_RANK.EXACT_NAME}
        when ${exactMatch} then ${CATALOG_MATCH_RANK.EXACT_TERMS}
        else ${CATALOG_MATCH_RANK.PREFIX}
      end::integer
    `.as('tier');

    const termHits = query.terms.map(term => sql`(${term} = any(${printing.nameTokens}))::integer`);
    const nameHits = sql<number>`${sql.join([sql`0`, ...termHits], sql` + `)}`.as('name_hits');

    const ranked = this.db
      .selectDistinctOn([printing.pricingId], {
        pricingId: printing.pricingId,
        providerId: printing.providerId,
        setName: printing.setName,
        tier,
        nameHits,
      })
      .from(printing)
      .where(and(eq(printing.generation, generation), selectedLanguages, or(identifierMatch, textMatch)))
      .orderBy(fields => {
        return [fields.pricingId, fields.tier, desc(fields.nameHits), desc(printing.primarySet), printing.setKey];
      })
      .as('ranked_catalog_printings');

    const rows = await this.db
      .select({ pricingId: ranked.pricingId, providerId: ranked.providerId, setName: ranked.setName })
      .from(ranked)
      .orderBy(ranked.tier, desc(ranked.nameHits), sql`${ranked.pricingId} collate "C"`)
      .limit(CATALOG_PAGE_SIZE + CATALOG_PAGE_LOOKAHEAD)
      .offset(offset);

    return {
      printings: rows.slice(0, CATALOG_PAGE_SIZE),
      nextOffset: rows.length > CATALOG_PAGE_SIZE ? offset + CATALOG_PAGE_SIZE : undefined,
    };
  }

  private matches(vector: SQL, terms: readonly string[], prefix: boolean): SQL {
    if (terms.length === 0) {
      return prefix ? sql`false` : sql`true`;
    }

    const query = terms
      .map((term, index) => {
        const isPrefix =
          prefix && index === terms.length - 1 && CATALOG_PREFIX_LENGTH_PATTERN.test(term) && !/^\d+$/.test(term);

        return `'${term}'${isPrefix ? ':*' : ''}`;
      })
      .join(' & ');

    return sql`${vector} @@ ${query}::tsquery`;
  }

  private identifierCondition(identifier: CatalogIdentifier) {
    const field = {
      [CATALOG_IDENTIFIER_FIELD_MAP.PROVIDER]: cardCatalogPrinting.providerId,
      [CATALOG_IDENTIFIER_FIELD_MAP.PRINTED]: cardCatalogPrinting.printedNumber,
      [CATALOG_IDENTIFIER_FIELD_MAP.COLLECTOR]: cardCatalogPrinting.collectorNumber,
    }[identifier.field];

    const sets =
      identifier.sets.length > 0 ? arrayOverlaps(cardCatalogPrinting.setIds, [...identifier.sets]) : undefined;

    return and(eq(field, identifier.value), sets);
  }
}
