import crypto from 'node:crypto';

import { and, count, desc, eq, sql } from 'drizzle-orm';

import { ensureUnfiled, type Transaction } from './collection-transactions.ts';
import { BinderFull, CollectionNotFound } from '../../collections/exceptions.ts';
import { binderPage, binderSlot, cardCollection } from '../../db/schema/cards.ts';
import type { AuthenticatedIdentity } from '../contracts.ts';

interface PlacementOptions {
  tx: Transaction;
  identity: AuthenticatedIdentity;
  collectionId: string | null;
  cardId: string;
  quantity: number;
  maximumPages: number;
}

export async function placeCardInBinder({
  tx,
  identity,
  collectionId,
  cardId,
  quantity,
  maximumPages,
}: PlacementOptions) {
  const [collection] =
    collectionId == null
      ? [await ensureUnfiled(tx, identity)]
      : await tx
          .select()
          .from(cardCollection)
          .where(and(eq(cardCollection.id, collectionId), eq(cardCollection.userId, identity.requireUserId())));

  if (collection == null) {
    throw new CollectionNotFound();
  }

  const capacity = collection.rows * collection.columns;
  const occupancy = tx.select({ count: count() }).from(binderSlot).where(eq(binderSlot.pageId, binderPage.id));

  const [page] = await tx
    .select({ id: binderPage.id })
    .from(binderPage)
    .where(and(eq(binderPage.collectionId, collection.id), sql`(${occupancy}) < ${capacity}`))
    .orderBy(binderPage.position)
    .limit(1);

  if (page != null) {
    const occupied = await tx
      .select({ row: binderSlot.row, column: binderSlot.column })
      .from(binderSlot)
      .where(eq(binderSlot.pageId, page.id));

    const positions = new Set(occupied.map(slot => `${slot.row}:${slot.column}`));

    for (let position = 0; position < capacity; position += 1) {
      const row = Math.floor(position / collection.columns) + 1;
      const column = (position % collection.columns) + 1;

      if (!positions.has(`${row}:${column}`)) {
        await tx.insert(binderSlot).values({ pageId: page.id, cardId, row, column, quantity });

        return;
      }
    }

    throw new BinderFull();
  }

  const [last] = await tx
    .select({ position: binderPage.position })
    .from(binderPage)
    .where(eq(binderPage.collectionId, collection.id))
    .orderBy(desc(binderPage.position))
    .limit(1);

  const position = last == null ? 0 : last.position + 1;

  if (position >= maximumPages) {
    throw new BinderFull();
  }

  const pageId = crypto.randomUUID();
  await tx.insert(binderPage).values({ id: pageId, collectionId: collection.id, position });
  await tx.insert(binderSlot).values({ pageId, cardId, row: 1, column: 1, quantity });
}
