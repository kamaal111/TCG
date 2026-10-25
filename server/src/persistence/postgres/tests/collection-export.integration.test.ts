import crypto from 'node:crypto';

import { ImportCardSchema } from '../../../cards/schemas/payloads.ts';
import { sessionHeaders } from '../../../cards/tests/utils.ts';
import { BackupSchema, CollectionSchema } from '../../../collections/schemas/responses.ts';
import { binderPage, binderSlot, card, cardCollection, cardPurchaseBatch } from '../../../db/schema/cards.ts';
import { integrationTest } from '../../../tests/fixtures.ts';
import { createTestUser } from '../../../tests/utils.ts';
import { COLLECTION_BATCH_SIZE } from '../collection-batches.ts';

integrationTest(
  'exports slots and purchases across batch boundaries after a long empty-page prefix',
  async ({ app, db }) => {
    const user = await createTestUser(app, db);
    const collectionId = crypto.randomUUID();
    const collectionSourceId = crypto.randomUUID();
    const cardId = crypto.randomUUID();
    const cardSourceId = crypto.randomUUID();
    const pageCount = 2 * COLLECTION_BATCH_SIZE + 2;
    const emptyPageCount = COLLECTION_BATCH_SIZE + 1;

    await db.insert(cardCollection).values({
      id: collectionId,
      userId: user.userId,
      importSourceId: collectionSourceId,
      name: 'Binder',
      columns: 1,
      rows: 4,
    });
    await db.insert(card).values({
      id: cardId,
      userId: user.userId,
      importSourceId: cardSourceId,
      collectionId,
      game: 'pokemon',
      name: 'Évoli 🂡',
      setName: 'Base',
      cardNumber: '1',
    });

    const pages = Array.from({ length: pageCount }, (_, position) => ({
      id: crypto.randomUUID(),
      collectionId,
      position,
    }));

    await db.insert(binderPage).values(pages);

    const slots = pages
      .slice(emptyPageCount)
      .map(page => ({ pageId: page.id, cardId, row: (page.position % 4) + 1, column: 1, quantity: 1 }));

    await db.insert(binderSlot).values(slots);

    const purchases = await db
      .insert(cardPurchaseBatch)
      .values(slots.map(() => ({ cardId, condition: 'near_mint', quantity: 1 }) as const))
      .returning({ id: cardPurchaseBatch.id });

    const response = await app.request('/app-api/collections/export', {
      method: 'POST',
      headers: sessionHeaders(user.sessionToken),
      body: JSON.stringify({ collection_ids: [collectionId] }),
    });

    expect(response.status).toBe(200);
    const backup = BackupSchema.parse(await response.json());
    const collection = CollectionSchema.parse(backup.collections[0]);
    const exportedCard = ImportCardSchema.parse(backup.cards[0]);
    expect(collection.id).toBe(collectionSourceId);
    expect(collection.pages.map(page => page.id)).toEqual(pages.map(page => page.id));
    expect(collection.pages.slice(0, emptyPageCount).every(page => page.slots.length === 0)).toBe(true);
    expect(collection.pages.flatMap(page => page.slots)).toEqual(
      slots.map(slot => ({ row: slot.row, column: slot.column, quantity: slot.quantity, card_id: cardSourceId })),
    );
    expect(exportedCard.id).toBe(cardSourceId);
    expect(exportedCard.collection_id).toBe(collectionSourceId);
    expect(exportedCard.name).toBe('Évoli 🂡');
    expect(exportedCard.purchases.map(purchase => purchase.id)).toEqual(
      purchases.map(purchase => purchase.id).toSorted(),
    );
  },
);
