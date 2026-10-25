import crypto from 'node:crypto';

import { and, eq, inArray, isNull, or, sql } from 'drizzle-orm';

import { COLLECTION_BATCH_SIZE } from './collection-batches.ts';
import { CollectionNotFound } from '../../collections/exceptions.ts';
import type { Database } from '../../db/index.ts';
import { binderPage, binderSlot, cardCollection, card } from '../../db/schema/cards.ts';
import type { AuthenticatedIdentity } from '../contracts.ts';

export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

export async function lockCollections(tx: Transaction, identity: AuthenticatedIdentity) {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${'cards.import:' + identity.requireUserId()}, 0))`,
  );
}

export async function ensureUnfiled(tx: Transaction, identity: AuthenticatedIdentity) {
  const userId = identity.requireUserId();

  const find = () =>
    tx
      .select()
      .from(cardCollection)
      .where(and(eq(cardCollection.userId, userId), eq(cardCollection.isUnfiled, true)));

  const [existing] = await find();

  if (existing != null) {
    return existing;
  }

  await tx
    .insert(cardCollection)
    .values({ id: crypto.randomUUID(), userId, name: 'Unfiled', isUnfiled: true })
    .onConflictDoNothing();

  const [collection] = await find();

  if (collection == null) {
    throw new CollectionNotFound();
  }

  return collection;
}

export async function collectionMembership(
  tx: Transaction,
  identity: AuthenticatedIdentity,
  id: string | null | undefined,
) {
  if (id == null) {
    return null;
  }

  const [owned] = await tx
    .select()
    .from(cardCollection)
    .where(and(eq(cardCollection.id, id), eq(cardCollection.userId, identity.requireUserId())));

  if (owned == null) {
    throw new CollectionNotFound();
  }

  return owned.isUnfiled ? null : owned.id;
}

export async function bumpCollections(
  tx: Transaction,
  identity: AuthenticatedIdentity,
  collectionIds: readonly (string | null)[],
) {
  if (collectionIds.length === 0) {
    return;
  }

  const ids = [...new Set(collectionIds.filter(id => id !== null))];
  await tx
    .update(cardCollection)
    .set({ revision: sql`${cardCollection.revision} + 1` })
    .where(
      and(
        eq(cardCollection.userId, identity.requireUserId()),
        or(
          collectionIds.includes(null) ? eq(cardCollection.isUnfiled, true) : undefined,
          ids.length > 0 ? inArray(cardCollection.id, ids) : undefined,
        ),
      ),
    );
}

export async function clearPlacements(tx: Transaction, identity: AuthenticatedIdentity, cardIds: readonly string[]) {
  for (let start = 0; start < cardIds.length; start += COLLECTION_BATCH_SIZE) {
    const owned = tx
      .select({ id: card.id })
      .from(card)
      .where(
        and(
          inArray(card.id, cardIds.slice(start, start + COLLECTION_BATCH_SIZE)),
          eq(card.userId, identity.requireUserId()),
        ),
      );

    await tx.delete(binderSlot).where(inArray(binderSlot.cardId, owned));
  }
}

interface ReconcilePlacementsOptions {
  cardId: string;
  total: number;
}

export async function reconcilePlacements(
  tx: Transaction,
  identity: AuthenticatedIdentity,
  entries: readonly ReconcilePlacementsOptions[],
) {
  if (entries.length === 0) {
    return 0;
  }

  const remainingByCard = new Map(entries.map(entry => [entry.cardId, entry.total]));
  let removed = 0;
  let cursor: { cardId: string; position: number; row: number; column: number; id: string } | undefined;

  while (true) {
    const slots = await tx
      .select({ slot: binderSlot, position: binderPage.position })
      .from(binderSlot)
      .innerJoin(binderPage, eq(binderSlot.pageId, binderPage.id))
      .innerJoin(card, eq(binderSlot.cardId, card.id))
      .where(
        and(
          inArray(card.id, [...remainingByCard.keys()]),
          eq(card.userId, identity.requireUserId()),
          cursor != null
            ? sql`(${binderSlot.cardId}, ${binderPage.position}, ${binderSlot.row}, ${binderSlot.column}, ${binderSlot.id}) > (${cursor.cardId}, ${cursor.position}, ${cursor.row}, ${cursor.column}, ${cursor.id})`
            : undefined,
        ),
      )
      .orderBy(binderSlot.cardId, binderPage.position, binderSlot.row, binderSlot.column, binderSlot.id)
      .limit(COLLECTION_BATCH_SIZE);

    const deleted: string[] = [];
    const adjusted: { id: string; quantity: number }[] = [];

    for (const { slot, position } of slots) {
      const remaining = remainingByCard.get(slot.cardId);

      if (remaining == null) {
        throw new CollectionNotFound();
      }

      const keep = Math.min(remaining, slot.quantity);
      remainingByCard.set(slot.cardId, remaining - keep);
      removed += slot.quantity - keep;
      cursor = { ...slot, position };

      if (keep === 0) {
        deleted.push(slot.id);
      } else if (keep !== slot.quantity) {
        adjusted.push({ id: slot.id, quantity: keep });
      }
    }

    if (deleted.length > 0) {
      await tx.delete(binderSlot).where(inArray(binderSlot.id, deleted));
    }

    if (adjusted.length > 0) {
      const cases = adjusted.map(slot => sql`when ${slot.id}::uuid then ${slot.quantity}::integer`);
      await tx
        .update(binderSlot)
        .set({ quantity: sql`case ${binderSlot.id} ${sql.join(cases, sql` `)} else ${binderSlot.quantity} end` })
        .where(
          inArray(
            binderSlot.id,
            adjusted.map(slot => slot.id),
          ),
        );
    }

    if (slots.length < COLLECTION_BATCH_SIZE) {
      return removed;
    }
  }
}

export function membershipFilter(collectionId: string | null) {
  return collectionId == null ? isNull(card.collectionId) : eq(card.collectionId, collectionId);
}
