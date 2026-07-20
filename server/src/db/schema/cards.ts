import crypto from 'node:crypto';

import { defineRelationsPart } from 'drizzle-orm';
import { index, integer, pgEnum, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

import { user } from './better-auth.ts';

export const CARD_GAMES = ['one_piece', 'pokemon'] as const;
export const CARD_CONDITIONS = ['mint', 'near_mint', 'excellent', 'good', 'played', 'damaged'] as const;

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
    notes: text('notes'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  table => [index('card_userId_createdAt_idx').on(table.userId, table.createdAt)],
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

export const cardsRelations = defineRelationsPart({ user, card, cardConditionQuantity }, r => ({
  card: {
    user: r.one.user({ from: r.card.userId, to: r.user.id }),
    quantities: r.many.cardConditionQuantity({
      from: r.card.id,
      to: r.cardConditionQuantity.cardId,
    }),
  },
  cardConditionQuantity: {
    card: r.one.card({ from: r.cardConditionQuantity.cardId, to: r.card.id }),
  },
}));
