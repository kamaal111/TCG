import crypto from 'node:crypto';

import { and, desc, eq } from 'drizzle-orm';

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

  const [lastOccupied] = await tx
    .select({ position: binderPage.position, row: binderSlot.row, column: binderSlot.column })
    .from(binderPage)
    .innerJoin(binderSlot, eq(binderSlot.pageId, binderPage.id))
    .where(eq(binderPage.collectionId, collection.id))
    .orderBy(desc(binderPage.position), desc(binderSlot.row), desc(binderSlot.column))
    .limit(1);

  const capacity = collection.rows * collection.columns;
  const nextSlot = lastOccupied == null ? 0 : (lastOccupied.row - 1) * collection.columns + lastOccupied.column;
  const position = (lastOccupied?.position ?? 0) + Math.floor(nextSlot / capacity);
  const slotIndex = nextSlot % capacity;
  const row = Math.floor(slotIndex / collection.columns) + 1;
  const column = (slotIndex % collection.columns) + 1;

  const [page] = await tx
    .select({ id: binderPage.id })
    .from(binderPage)
    .where(and(eq(binderPage.collectionId, collection.id), eq(binderPage.position, position)))
    .limit(1);

  if (page != null) {
    await tx.insert(binderSlot).values({ pageId: page.id, cardId, row, column, quantity });

    return;
  }

  if (position >= maximumPages) {
    throw new BinderFull();
  }

  const pageId = crypto.randomUUID();
  await tx.insert(binderPage).values({ id: pageId, collectionId: collection.id, position });
  await tx.insert(binderSlot).values({ pageId, cardId, row, column, quantity });
}
