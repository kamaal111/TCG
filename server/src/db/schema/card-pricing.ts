import crypto from 'node:crypto';

import { date, index, jsonb, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

import { cardGameEnum } from './cards.ts';
import type { NormalizedPricing, TCGGORawCard } from '../../card-pricing/tcggo/types.ts';

export const cardPrice = pgTable(
  'card_price',
  {
    id: text('id').primaryKey().$defaultFn(crypto.randomUUID),
    game: cardGameEnum('game').notNull(),
    tcggoCardId: text('tcggo_card_id').notNull(),
    cardNumber: text('card_number').notNull(),
    name: text('name').notNull(),
    pricedOn: date('priced_on').notNull(),
    prices: jsonb('prices').$type<NormalizedPricing>().notNull(),
    raw: jsonb('raw').$type<TCGGORawCard>(),
    source: text('source').$type<'static' | 'real'>().notNull(),
    fetchedAt: timestamp('fetched_at').defaultNow().notNull(),
  },
  table => [
    uniqueIndex('card_price_game_tcggoCardId_pricedOn_idx').on(table.game, table.tcggoCardId, table.pricedOn),
    index('card_price_game_cardNumber_pricedOn_idx').on(table.game, table.cardNumber, table.pricedOn),
  ],
);

export const cardPriceSearch = pgTable(
  'card_price_search',
  {
    id: text('id').primaryKey().$defaultFn(crypto.randomUUID),
    game: cardGameEnum('game').notNull(),
    queryKey: text('query_key').notNull(),
    pricedOn: date('priced_on').notNull(),
    tcggoCardIds: jsonb('tcggo_card_ids').$type<string[]>().notNull(),
    fetchedAt: timestamp('fetched_at').defaultNow().notNull(),
  },
  table => [uniqueIndex('card_price_search_game_queryKey_pricedOn_idx').on(table.game, table.queryKey, table.pricedOn)],
);
