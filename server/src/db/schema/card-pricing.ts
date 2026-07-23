import crypto from 'node:crypto';

import { defineRelationsPart } from 'drizzle-orm';
import { date, index, jsonb, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

import { cardGameEnum } from './cards.ts';
import type { NormalizedPricing, PricingSource } from '../../card-pricing/types.ts';

export const cardPrice = pgTable(
  'card_price',
  {
    id: text('id').primaryKey().$defaultFn(crypto.randomUUID),
    game: cardGameEnum('game').notNull(),
    pricingCardId: text('pricing_card_id').notNull(),
    cardNumber: text('card_number').notNull(),
    name: text('name').notNull(),
    pricedOn: date('priced_on').notNull(),
    prices: jsonb('prices').$type<NormalizedPricing>().notNull(),
    raw: jsonb('raw').$type<unknown>(),
    pricingSource: text('pricing_source').$type<PricingSource>().notNull(),
    fetchedAt: timestamp('fetched_at').defaultNow().notNull(),
  },
  table => [
    uniqueIndex('card_price_source_game_cardId_pricedOn_idx').on(
      table.pricingSource,
      table.game,
      table.pricingCardId,
      table.pricedOn,
    ),
    index('card_price_source_game_cardNumber_pricedOn_idx').on(
      table.pricingSource,
      table.game,
      table.cardNumber,
      table.pricedOn,
    ),
  ],
);

export const cardPriceSearch = pgTable(
  'card_price_search',
  {
    id: text('id').primaryKey().$defaultFn(crypto.randomUUID),
    game: cardGameEnum('game').notNull(),
    queryKey: text('query_key').notNull(),
    pricedOn: date('priced_on').notNull(),
    pricingCardIds: jsonb('pricing_card_ids').$type<string[]>().notNull(),
    pricingSource: text('pricing_source').$type<PricingSource>().notNull(),
    fetchedAt: timestamp('fetched_at').defaultNow().notNull(),
  },
  table => [
    uniqueIndex('card_price_search_source_game_queryKey_pricedOn_idx').on(
      table.pricingSource,
      table.game,
      table.queryKey,
      table.pricedOn,
    ),
  ],
);

export const cardPricingRelations = defineRelationsPart({ cardPrice, cardPriceSearch });
