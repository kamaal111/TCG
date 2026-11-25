import { sql, type SQLWrapper } from 'drizzle-orm';
import { boolean, index, integer, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { cardGameEnum } from './cards.ts';
import type { PricingSource } from '../../card-pricing/types.ts';

export function cardCatalogTermsVector(printing: { nameTokens: SQLWrapper; setTokens: SQLWrapper }) {
  return sql`array_to_tsvector(${printing.nameTokens} || ${printing.setTokens})`;
}

export const cardCatalogGeneration = pgTable(
  'card_catalog_generation',
  {
    id: uuid().primaryKey(),
    source: text().$type<PricingSource>().notNull(),
    game: cardGameEnum().notNull(),
    publishedAt: timestamp('published_at', { withTimezone: true }).defaultNow().notNull(),
    supersededAt: timestamp('superseded_at', { withTimezone: true }),
    printingCount: integer('printing_count').notNull(),
  },
  table => {
    return [
      uniqueIndex('card_catalog_active_idx')
        .on(table.source, table.game)
        .where(sql`${table.supersededAt} is null`),
    ];
  },
);

export const cardCatalogPrinting = pgTable(
  'card_catalog_printing',
  {
    generation: uuid()
      .notNull()
      .references(() => cardCatalogGeneration.id, { onDelete: 'cascade' }),
    pricingId: text('pricing_id').notNull(),
    providerId: text('provider_id').notNull(),
    language: text().notNull(),
    names: text().array().notNull(),
    nameTokens: text('name_tokens').array().notNull(),
    setTokens: text('set_tokens').array().notNull(),
    setKey: text('set_key').notNull(),
    setName: text('set_name'),
    primarySet: boolean('primary_set').notNull(),
    setIds: text('set_ids').array().notNull(),
    collectorNumber: text('collector_number').notNull(),
    printedNumber: text('printed_number').notNull(),
  },
  table => {
    return [
      primaryKey({ columns: [table.generation, table.pricingId, table.setKey] }),
      index('card_catalog_terms_idx').using('gin', cardCatalogTermsVector(table)),
      index('card_catalog_provider_idx').on(table.generation, table.providerId),
      index('card_catalog_collector_idx').on(table.generation, table.collectorNumber),
      index('card_catalog_printed_idx').on(table.generation, table.printedNumber),
    ];
  },
);
