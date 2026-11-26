import fs from 'node:fs';
import type sqlite from 'node:sqlite';
import url from 'node:url';

import { InternalServerError } from '@tcg/http/exceptions';
import { and, desc, eq, inArray, max, sql, type SQLWrapper } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-sqlite';
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { z } from 'zod';

import { CATALOG_IDENTIFIER_FIELD_MAP } from '../../card-pricing/catalog-query.ts';
import { CatalogPrintingSchema, type CardCatalog, type CatalogSearch } from '../../card-pricing/catalog.ts';
import { CARD_GAME_MAP } from '../../card-pricing/types.ts';
import { CATALOG_PAGE_SIZE } from '../../card-pricing/utils/pagination.ts';

export const CARD_CATALOG_PATH = url.fileURLToPath(new URL('../../../catalog.sqlite', import.meta.url));

const CATALOG_SCHEMA_VERSION = 1;
const PAGE_LOOKAHEAD = 1;
const MIN_PREFIX_LENGTH = 2;

export const catalogPrintingTable = sqliteTable('printing', {
  id: integer().primaryKey(),
  game: text().notNull(),
  pricingId: text('pricing_id').notNull(),
  providerId: text('provider_id').notNull(),
  language: text().notNull(),
  names: text().notNull(),
  nameTokens: text('name_tokens').notNull(),
  setTokens: text('set_tokens').notNull(),
  setIds: text('set_ids').notNull(),
  setKey: text('set_key').notNull(),
  setName: text('set_name'),
  primarySet: integer('primary_set').notNull(),
  collectorNumber: text('collector_number').notNull(),
  printedNumber: text('printed_number').notNull(),
});

const catalogVersionTable = sqliteTable('catalog_version', { id: text().primaryKey() });
const catalogFtsTable = sqliteTable('catalog_fts', { rowId: integer('rowid').notNull() });

const IDENTIFIER_COLUMN = {
  [CATALOG_IDENTIFIER_FIELD_MAP.PROVIDER]: catalogPrintingTable.providerId,
  [CATALOG_IDENTIFIER_FIELD_MAP.COLLECTOR]: catalogPrintingTable.collectorNumber,
  [CATALOG_IDENTIFIER_FIELD_MAP.PRINTED]: catalogPrintingTable.printedNumber,
} as const;

const CatalogResultSchema = z.array(
  CatalogPrintingSchema.pick({ pricingId: true, providerId: true }).extend({
    setName: z.string().nullable(),
  }),
);

export function initializeCatalogSchema(db: sqlite.DatabaseSync): void {
  db.exec(`PRAGMA user_version = ${CATALOG_SCHEMA_VERSION}`);
  db.exec(fs.readFileSync(new URL('./card-catalog.sql', import.meta.url), 'utf8'));
}

function containsTerm(column: SQLWrapper, term: string) {
  return sql`instr(' ' || ${column} || ' ', ${` ${term} `}) > 0`;
}

function allTerms(terms: readonly string[]) {
  const tokens = sql`${catalogPrintingTable.nameTokens} || ' ' || ${catalogPrintingTable.setTokens}`;

  return and(...terms.map(term => containsTerm(tokens, term)));
}

function toFtsQuery(terms: readonly string[]) {
  return terms
    .map((term, index) => {
      const prefix = index === terms.length - 1 && Array.from(term).length >= MIN_PREFIX_LENGTH && !/^\d+$/.test(term);

      return `"${term}"${prefix ? '*' : ''}`;
    })
    .join(' AND ');
}

function matchCatalog(query: string) {
  return sql`${catalogFtsTable} MATCH ${query}`;
}

export class SQLiteCardCatalog implements CardCatalog, Disposable {
  readonly version: string;
  private readonly db: ReturnType<typeof drizzle>;

  constructor(path: string) {
    this.db = drizzle({ connection: { path, readOnly: true } });

    try {
      const schema = this.db.$client.prepare('PRAGMA user_version').get()?.user_version;
      const version = z.uuid().parse(this.db.select().from(catalogVersionTable).get()?.id);
      const games = this.db.selectDistinct({ game: catalogPrintingTable.game }).from(catalogPrintingTable).all();

      if (
        schema !== CATALOG_SCHEMA_VERSION ||
        games.length !== Object.keys(CARD_GAME_MAP).length ||
        this.db.$client.prepare('PRAGMA quick_check').get()?.quick_check !== 'ok'
      ) {
        throw new InternalServerError(undefined, { diagnosticMessage: 'Invalid SQLite card catalog' });
      }

      this.db.select().from(catalogFtsTable).where(matchCatalog('catalog')).limit(1).get();
      this.version = version;
    } catch (cause) {
      this.db.$client.close();

      throw new InternalServerError(undefined, { diagnosticMessage: 'Could not verify SQLite card catalog', cause });
    }
  }

  [Symbol.dispose](): void {
    this.db.$client.close();
  }

  search({ game, query, languages, offset }: CatalogSearch) {
    const printing = catalogPrintingTable;
    const gameMatches = eq(printing.game, game);
    const identifierTermsMatch = allTerms(query.identifierTerms);

    const exactCandidates = query.identifiers.map(identifier => {
      const setsMatch =
        identifier.sets.length === 0
          ? undefined
          : sql`EXISTS (SELECT 1 FROM json_each(${printing.setIds}) WHERE ${inArray(sql`value`, identifier.sets)})`;

      return this.db
        .select({ id: sql<number>`${printing.id}`.as('id'), identifier: sql<number>`1`.as('identifier') })
        .from(printing)
        .where(
          and(gameMatches, eq(IDENTIFIER_COLUMN[identifier.field], identifier.value), setsMatch, identifierTermsMatch),
        );
    });

    const textCandidates =
      query.requireIdentifier || query.terms.length === 0
        ? []
        : [
            this.db
              .select({
                id: sql<number>`${catalogFtsTable.rowId}`.as('id'),
                identifier: sql<number>`0`.as('identifier'),
              })
              .from(catalogFtsTable)
              .where(matchCatalog(toFtsQuery(query.terms))),
          ];

    const [first, ...rest] = [...textCandidates, ...exactCandidates];

    if (!first) {
      return { printings: [], nextOffset: undefined };
    }

    for (const candidate of rest) {
      first.unionAll(candidate);
    }

    const candidates = this.db.$with('candidates').as(first);

    const found = this.db.$with('found').as(
      this.db
        .select({ id: candidates.id, identifier: max(candidates.identifier).as('identifier') })
        .from(candidates)
        .groupBy(candidates.id),
    );

    const exactName = query.terms.join(' ');
    const exactText = allTerms(query.terms) ?? sql`1`;
    const nameHits = query.terms.map(term => sql`(${containsTerm(printing.nameTokens, term)})`);

    const scored = this.db.$with('scored').as(
      this.db
        .select({
          pricingId: printing.pricingId,
          providerId: printing.providerId,
          setName: printing.setName,
          primarySet: printing.primarySet,
          setKey: printing.setKey,
          tier: sql<number>`CASE WHEN ${found.identifier} THEN 0
          WHEN EXISTS (SELECT 1 FROM json_each(${printing.names}) WHERE value = ${exactName}) THEN 1
          WHEN ${exactText} THEN 2 ELSE 3 END`.as('tier'),
          nameHits: sql<number>`${nameHits.length ? sql.join(nameHits, sql` + `) : sql`0`}`.as('name_hits'),
        })
        .from(found)
        .innerJoin(printing, eq(found.id, printing.id))
        .where(and(gameMatches, languages.length ? inArray(printing.language, languages) : undefined)),
    );

    const ranked = this.db.$with('ranked').as(
      this.db
        .select({
          pricingId: scored.pricingId,
          providerId: scored.providerId,
          setName: scored.setName,
          tier: scored.tier,
          nameHits: scored.nameHits,
          printingRank: sql<number>`row_number() OVER (
          PARTITION BY ${scored.pricingId}
          ORDER BY ${scored.tier}, ${desc(scored.nameHits)}, ${desc(scored.primarySet)}, ${scored.setKey}
        )`.as('printing_rank'),
        })
        .from(scored),
    );

    const rows = CatalogResultSchema.parse(
      this.db
        .with(candidates, found, scored, ranked)
        .select({ pricingId: ranked.pricingId, providerId: ranked.providerId, setName: ranked.setName })
        .from(ranked)
        .where(eq(ranked.printingRank, 1))
        .orderBy(ranked.tier, desc(ranked.nameHits), ranked.pricingId)
        .limit(CATALOG_PAGE_SIZE + PAGE_LOOKAHEAD)
        .offset(offset)
        .all(),
    );

    return {
      printings: rows.slice(0, CATALOG_PAGE_SIZE),
      nextOffset: rows.length > CATALOG_PAGE_SIZE ? offset + CATALOG_PAGE_SIZE : undefined,
    };
  }
}
