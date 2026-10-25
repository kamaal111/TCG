import { defineRelationsPart, sql } from 'drizzle-orm';
import {
  check,
  boolean,
  foreignKey,
  index,
  integer,
  numeric,
  date,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { user } from './better-auth.ts';
import { currencyConstraint } from './currency.ts';
import type { Currency } from '../../card-pricing/types.ts';
import { CARD_GAMES, CARD_CONDITIONS, MAX_COPIES_PER_CONDITION } from '../../cards/types.ts';
import { MAX_BINDER_DIMENSION } from '../../collections/constants.ts';

export const cardGameEnum = pgEnum('card_game', CARD_GAMES);

export const cardConditionEnum = pgEnum('card_condition', CARD_CONDITIONS);

export const cardCollection = pgTable(
  'card_collection',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    importSourceId: uuid('import_source_id'),
    name: text('name').notNull(),
    isUnfiled: boolean('is_unfiled').notNull().default(false),
    columns: integer('columns').notNull().default(3),
    rows: integer('rows').notNull().default(3),
    revision: integer('revision').notNull().default(0),
  },
  t => [
    index('collection_user_id_idx').on(t.userId, t.id),
    uniqueIndex('collection_id_user_idx').on(t.id, t.userId),
    uniqueIndex('collection_user_source_idx').on(t.userId, t.importSourceId),
    uniqueIndex('collection_user_unfiled_idx')
      .on(t.userId)
      .where(sql`${t.isUnfiled}`),
    check(
      'collection_dimensions_check',
      sql`${t.columns} between 1 and ${sql.raw(String(MAX_BINDER_DIMENSION))} and ${t.rows} between 1 and ${sql.raw(String(MAX_BINDER_DIMENSION))}`,
    ),
  ],
);

export const card = pgTable(
  'card',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    importSourceId: uuid('import_source_id'),
    collectionId: uuid('collection_id'),
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
    uniqueIndex('card_id_user_idx').on(table.id, table.userId),
    foreignKey({
      columns: [table.collectionId, table.userId],
      foreignColumns: [cardCollection.id, cardCollection.userId],
    }),
    index('card_user_collection_idx').on(table.userId, table.collectionId, table.createdAt.desc(), table.id.desc()),
    uniqueIndex('card_userId_importSourceId_idx').on(table.userId, table.importSourceId),
    index('card_userId_createdAt_id_idx').on(table.userId, table.createdAt.desc(), table.id.desc()),
    check(
      'card_pricing_identity_pair_check',
      sql`(${table.pricingCardId} is null and ${table.pricingSource} is null) or (${table.pricingCardId} is not null and ${table.pricingSource} is not null)`,
    ),
  ],
);

export const binderPage = pgTable(
  'binder_page',
  {
    id: uuid('id').primaryKey(),
    collectionId: uuid('collection_id')
      .notNull()
      .references(() => cardCollection.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
  },
  t => [uniqueIndex('binder_page_position_idx').on(t.collectionId, t.position)],
);

export const binderSlot = pgTable(
  'binder_slot',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    pageId: uuid('page_id')
      .notNull()
      .references(() => binderPage.id, { onDelete: 'cascade' }),
    cardId: uuid('card_id')
      .notNull()
      .references(() => card.id, { onDelete: 'cascade' }),
    row: integer('row').notNull(),
    column: integer('column').notNull(),
    quantity: integer('quantity').notNull(),
  },
  t => [
    uniqueIndex('binder_slot_position_idx').on(t.pageId, t.row, t.column),
    index('binder_slot_card_idx').on(t.cardId),
    check('binder_slot_positive_check', sql`${t.row} > 0 and ${t.column} > 0 and ${t.quantity} > 0`),
  ],
);

export const cardConditionQuantity = pgTable(
  'card_condition_quantity',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    cardId: uuid('card_id')
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
    id: uuid('id').primaryKey().defaultRandom(),
    cardId: uuid('card_id')
      .notNull()
      .references(() => card.id, { onDelete: 'cascade' }),
    condition: cardConditionEnum('condition').notNull(),
    quantity: integer('quantity').notNull(),
    purchasePrice: numeric('purchase_price', { precision: 20, scale: 6 }),
    currency: text('currency').$type<Currency>(),
    automaticPriceDate: date('automatic_price_date'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  table => [
    index('card_purchase_batch_cardId_idx').on(table.cardId, table.id),
    check(
      'card_purchase_batch_quantity_check',
      sql`${table.quantity} between 1 and ${sql.raw(String(MAX_COPIES_PER_CONDITION))}`,
    ),
    check(
      'card_purchase_batch_price_check',
      sql`${table.purchasePrice} >= 0 and ${table.purchasePrice} < 'Infinity'::numeric`,
    ),
    check('card_purchase_batch_currency_check', sql`${table.currency} in ${currencyConstraint}`),
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
