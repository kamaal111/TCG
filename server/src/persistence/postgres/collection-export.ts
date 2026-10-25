import { and, eq, gt, gte, inArray, ne, or, sql } from 'drizzle-orm';

import { COLLECTION_BATCH_SIZE } from './collection-batches.ts';
import { ensureUnfiled, type Transaction } from './collection-transactions.ts';
import { serializeCard, serializePurchase } from '../../cards/utils/cards.ts';
import type { BackupWriter } from '../../collections/backup-stream.ts';
import { COLLECTION_BACKUP_VERSION } from '../../collections/constants.ts';
import { CollectionNotFound } from '../../collections/exceptions.ts';
import { binderPage, binderSlot, card, cardCollection, cardPurchaseBatch } from '../../db/schema/cards.ts';
import type { AuthenticatedIdentity } from '../contracts.ts';

interface ExportOptions {
  tx: Transaction;
  identity: AuthenticatedIdentity;
  writer: BackupWriter;
  ids: string[] | undefined;
}

export async function exportCollectionBackup({ tx, identity, writer, ids }: ExportOptions) {
  const userId = identity.requireUserId();
  const unfiled = await ensureUnfiled(tx, identity);
  const selection = and(eq(cardCollection.userId, userId), ids != null ? inArray(cardCollection.id, ids) : undefined);

  if (ids != null) {
    const owned = await tx.select({ id: cardCollection.id }).from(cardCollection).where(selection);

    if (owned.length !== new Set(ids).size) {
      throw new CollectionNotFound();
    }
  }

  writer.ready();
  await writer.write(`{"version":${COLLECTION_BACKUP_VERSION},"collections":[`);
  let collectionCursor: string | undefined;
  let collectionSeparator = '';

  while (true) {
    const batch = await tx
      .select()
      .from(cardCollection)
      .where(and(selection, collectionCursor != null ? gt(cardCollection.id, collectionCursor) : undefined))
      .orderBy(cardCollection.id)
      .limit(COLLECTION_BATCH_SIZE);

    if (batch.length === 0) {
      break;
    }

    const ids = batch.map(collection => collection.id);
    const pages = exportPages(tx, ids);
    const slots = exportSlots(tx, ids);
    let nextPage = await pages.next();
    let nextSlot = await slots.next();

    for (const collection of batch) {
      const { id, importSourceId, name, isUnfiled, columns, rows, revision } = collection;
      const fields = { id: importSourceId ?? id, name, is_unfiled: isUnfiled, columns, rows, revision };
      await writer.write(collectionSeparator + JSON.stringify(fields).slice(0, -1) + ',"pages":[');
      let pageSeparator = '';

      while (!nextPage.done && nextPage.value.collectionId === collection.id) {
        const page = nextPage.value;
        await writer.write(pageSeparator + JSON.stringify({ id: page.id }).slice(0, -1) + ',"slots":[');
        let slotSeparator = '';

        while (!nextSlot.done && nextSlot.value.pageId === page.id) {
          const { pageId: _pageId, collectionId: _collectionId, position: _position, ...slot } = nextSlot.value;
          await writer.write(slotSeparator + JSON.stringify(slot));
          slotSeparator = ',';
          nextSlot = await slots.next();
        }

        await writer.write(']}');
        pageSeparator = ',';
        nextPage = await pages.next();
      }

      await writer.write(']}');
      collectionSeparator = ',';
      collectionCursor = id;
    }

    if (batch.length < COLLECTION_BATCH_SIZE) {
      break;
    }
  }

  await writer.write('],"cards":[');
  let cardCursor: { timestamp: string; id: string } | undefined;
  let cardSeparator = '';

  while (true) {
    const batch = await tx
      .select({
        card,
        cursorTimestamp: sql<string>`${card.createdAt}::text`,
        sourceCollectionId: sql<string>`coalesce(${cardCollection.importSourceId}, ${cardCollection.id})`,
      })
      .from(card)
      .innerJoin(
        cardCollection,
        and(
          eq(cardCollection.userId, card.userId),
          or(
            eq(card.collectionId, cardCollection.id),
            and(sql`${card.collectionId} is null`, eq(cardCollection.id, unfiled.id)),
          ),
        ),
      )
      .where(
        and(
          eq(card.userId, userId),
          selection,
          cardCursor != null
            ? sql`(${card.createdAt}, ${card.id}) > (${cardCursor.timestamp}, ${cardCursor.id})`
            : undefined,
        ),
      )
      .orderBy(card.createdAt, card.id)
      .limit(COLLECTION_BATCH_SIZE);

    const last = batch.at(-1);

    if (last == null) {
      break;
    }

    cardCursor = { timestamp: last.cursorTimestamp, id: last.card.id };
    const ordered = batch.toSorted((a, b) => a.card.id.localeCompare(b.card.id));

    const purchases = exportPurchases(
      tx,
      ordered.map(entry => entry.card.id),
    );

    let nextPurchase = await purchases.next();

    for (const entry of ordered) {
      const fields = serializeCard({ ...entry.card, purchaseBatches: [] });
      const { purchases: _purchases, ...core } = fields;
      await writer.write(
        cardSeparator +
          JSON.stringify({
            ...core,
            id: entry.card.importSourceId ?? entry.card.id,
            collection_id: entry.sourceCollectionId,
          }).slice(0, -1) +
          ',"purchases":[',
      );
      let purchaseSeparator = '';

      while (!nextPurchase.done && nextPurchase.value.cardId === entry.card.id) {
        const purchase = nextPurchase.value;
        await writer.write(purchaseSeparator + JSON.stringify(serializePurchase(purchase)));
        purchaseSeparator = ',';
        nextPurchase = await purchases.next();
      }

      await writer.write(']}');
      cardSeparator = ',';
    }

    if (batch.length < COLLECTION_BATCH_SIZE) {
      break;
    }
  }

  await writer.write(']');
}

async function* exportPages(tx: Transaction, ids: string[]) {
  let cursor: { collectionId: string; position: number } | undefined;

  while (true) {
    const pages = await tx
      .select()
      .from(binderPage)
      .where(
        and(
          inArray(binderPage.collectionId, ids),
          cursor != null
            ? sql`(${binderPage.collectionId}, ${binderPage.position}) > (${cursor.collectionId}, ${cursor.position})`
            : undefined,
        ),
      )
      .orderBy(binderPage.collectionId, binderPage.position)
      .limit(COLLECTION_BATCH_SIZE);

    for (const page of pages) {
      cursor = page;
      yield page;
    }

    if (pages.length < COLLECTION_BATCH_SIZE) {
      return;
    }
  }
}

async function* exportSlots(tx: Transaction, ids: string[]) {
  let cursor: { collectionId: string; position: number; row: number; column: number } | undefined;

  while (true) {
    const pages = tx
      .select({ id: binderPage.id, collectionId: binderPage.collectionId, position: binderPage.position })
      .from(binderPage)
      .where(
        and(
          inArray(binderPage.collectionId, ids),
          cursor != null
            ? or(
                gt(binderPage.collectionId, cursor.collectionId),
                and(eq(binderPage.collectionId, cursor.collectionId), gte(binderPage.position, cursor.position)),
              )
            : undefined,
        ),
      )
      .orderBy(binderPage.collectionId, binderPage.position)
      .as('export_pages');

    // A bounded lateral lookup keeps each page on the slot-position index.
    const pageSlots = tx
      .select({
        row: binderSlot.row,
        column: binderSlot.column,
        quantity: binderSlot.quantity,
        cardId: binderSlot.cardId,
      })
      .from(binderSlot)
      .where(
        and(
          eq(binderSlot.pageId, pages.id),
          cursor != null
            ? or(
                ne(pages.collectionId, cursor.collectionId),
                ne(pages.position, cursor.position),
                sql`(${binderSlot.row}, ${binderSlot.column}) > (${cursor.row}, ${cursor.column})`,
              )
            : undefined,
        ),
      )
      .orderBy(binderSlot.row, binderSlot.column)
      .limit(COLLECTION_BATCH_SIZE)
      .as('page_slots');

    const slots = await tx
      .select({
        pageId: pages.id,
        collectionId: pages.collectionId,
        position: pages.position,
        row: pageSlots.row,
        column: pageSlots.column,
        quantity: pageSlots.quantity,
        card_id: sql<string>`coalesce(${card.importSourceId}, ${card.id})`,
      })
      .from(pages)
      .innerJoinLateral(pageSlots, sql`true`)
      .innerJoin(card, eq(card.id, pageSlots.cardId))
      // Preserve the constant collection sort key outside the ordered subquery.
      .where(inArray(pages.collectionId, ids))
      .orderBy(pages.collectionId, pages.position, pageSlots.row, pageSlots.column)
      .limit(COLLECTION_BATCH_SIZE);

    for (const slot of slots) {
      cursor = slot;
      yield slot;
    }

    if (slots.length < COLLECTION_BATCH_SIZE) {
      return;
    }
  }
}

async function* exportPurchases(tx: Transaction, ids: string[]) {
  let cursor: { cardId: string; id: string } | undefined;

  while (true) {
    const purchases = await tx
      .select()
      .from(cardPurchaseBatch)
      .where(
        and(
          inArray(cardPurchaseBatch.cardId, ids),
          cursor != null
            ? sql`(${cardPurchaseBatch.cardId}, ${cardPurchaseBatch.id}) > (${cursor.cardId}, ${cursor.id})`
            : undefined,
        ),
      )
      .orderBy(cardPurchaseBatch.cardId, cardPurchaseBatch.id)
      .limit(COLLECTION_BATCH_SIZE);

    for (const purchase of purchases) {
      cursor = purchase;
      yield purchase;
    }

    if (purchases.length < COLLECTION_BATCH_SIZE) {
      return;
    }
  }
}
