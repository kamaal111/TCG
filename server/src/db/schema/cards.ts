import crypto from 'node:crypto';

import { defineRelationsPart, sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  numeric,
  date,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

import { user } from './better-auth.ts';

export const CARD_GAMES = ['one_piece', 'pokemon'] as const;

export const CARD_CONDITIONS = ['mint', 'near_mint', 'excellent', 'good', 'played', 'damaged'] as const;

export const MAX_COPIES_PER_CONDITION = 999;

export const cardGameEnum = pgEnum('card_game', CARD_GAMES);

export const cardConditionEnum = pgEnum('card_condition', CARD_CONDITIONS);

export const card = pgTable(
  'card',
  {
    id: text('id').primaryKey().$defaultFn(crypto.randomUUID),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    game: cardGameEnum('game').notNull(),
    name: text('name').notNull(),
    setName: text('set_name').notNull(),
    cardNumber: text('card_number').notNull(),
    pricingCardId: text('pricing_card_id'),
    pricingSource: text('pricing_source'),
    notes: text('notes'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  table => [
    index('card_userId_createdAt_idx').on(table.userId, table.createdAt),
    check(
      'card_pricing_identity_pair_check',
      sql`(${table.pricingCardId} is null and ${table.pricingSource} is null) or (${table.pricingCardId} is not null and ${table.pricingSource} is not null)`,
    ),
  ],
);

export const cardConditionQuantity = pgTable(
  'card_condition_quantity',
  {
    id: text('id').primaryKey().$defaultFn(crypto.randomUUID),
    cardId: text('card_id')
      .notNull()
      .references(() => card.id, { onDelete: 'cascade' }),
    condition: cardConditionEnum('condition').notNull(),
    quantity: integer('quantity').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  table => [uniqueIndex('card_condition_quantity_cardId_condition_idx').on(table.cardId, table.condition)],
);

export const cardPurchaseBatch = pgTable(
  'card_purchase_batch',
  {
    id: text('id').primaryKey().$defaultFn(crypto.randomUUID),
    cardId: text('card_id')
      .notNull()
      .references(() => card.id, { onDelete: 'cascade' }),
    condition: cardConditionEnum('condition').notNull(),
    quantity: integer('quantity').notNull(),
    purchasePrice: numeric('purchase_price', { precision: 20, scale: 6 }),
    currency: text('currency'),
    automaticPriceDate: date('automatic_price_date'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  table => [
    index('card_purchase_batch_cardId_idx').on(table.cardId),
    check(
      'card_purchase_batch_quantity_check',
      sql`${table.quantity} between 1 and ${sql.raw(String(MAX_COPIES_PER_CONDITION))}`,
    ),
    check(
      'card_purchase_batch_price_check',
      sql`${table.purchasePrice} >= 0 and ${table.purchasePrice} < 'Infinity'::numeric`,
    ),
    check('card_purchase_batch_currency_check', sql`${table.currency} in ('USD', 'JPY')`),
    check('card_purchase_batch_price_pair_check', sql`(${table.purchasePrice} is null) = (${table.currency} is null)`),
    check(
      'card_purchase_batch_date_check',
      sql`${table.automaticPriceDate} is null or ${table.purchasePrice} is not null`,
    ),
  ],
);

export const cardsRelations = defineRelationsPart({ user, card, cardConditionQuantity, cardPurchaseBatch }, r => ({
  card: {
    user: r.one.user({ from: r.card.userId, to: r.user.id }),
    purchaseBatches: r.many.cardPurchaseBatch({ from: r.card.id, to: r.cardPurchaseBatch.cardId }),
    quantities: r.many.cardConditionQuantity({
      from: r.card.id,
      to: r.cardConditionQuantity.cardId,
    }),
  },
  cardPurchaseBatch: {
    card: r.one.card({ from: r.cardPurchaseBatch.cardId, to: r.card.id }),
  },
  cardConditionQuantity: {
    card: r.one.card({ from: r.cardConditionQuantity.cardId, to: r.card.id }),
  },
}));
