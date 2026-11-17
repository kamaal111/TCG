import { index, jsonb, pgTable, primaryKey, text, timestamp } from 'drizzle-orm/pg-core';

import { user } from './better-auth.ts';
import type { WishlistCard } from '../../wishlist/schemas/responses.ts';

export const wishlist = pgTable(
  'wishlist',
  {
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    printingKey: text('printing_key').notNull(),
    card: jsonb('card').$type<Omit<WishlistCard, 'image_url'> & { originImageURL?: string }>().notNull(),
    savedAt: timestamp('saved_at').defaultNow().notNull(),
  },
  table => {
    return [
      primaryKey({ columns: [table.userId, table.printingKey] }),
      index('wishlist_user_saved_at_idx').on(table.userId, table.savedAt.desc(), table.printingKey.desc()),
    ];
  },
);
