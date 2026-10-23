import { defineRelationsPart, sql } from 'drizzle-orm';
import { check, date, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

import { user } from './better-auth.ts';
import { currencyConstraint } from './currency.ts';
import type { Currency } from '../../forex/currencies.ts';

export const exchangeRate = pgTable('exchange_rate', {
  date: date('date').primaryKey(),
  rates: jsonb('rates').$type<Record<string, number>>().notNull(),
  collectedAt: timestamp('collected_at', { withTimezone: true }).defaultNow().notNull(),
});

export const userPreferences = pgTable(
  'user_preferences',
  {
    userId: text('user_id')
      .primaryKey()
      .references(() => user.id, { onDelete: 'cascade' }),
    preferredCurrency: text('preferred_currency').$type<Currency>().notNull(),
  },
  table => [check('user_preferences_currency_check', sql`${table.preferredCurrency} in ${currencyConstraint}`)],
);

export const forexRelations = defineRelationsPart({ exchangeRate, userPreferences });
