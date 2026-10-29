import crypto from 'node:crypto';

import { eq, inArray } from 'drizzle-orm';
import type { Hono } from 'hono';

import { integrationTest } from './fixtures.ts';
import { readCollection, createTestCollection, saveLayout } from './utils.ts';
import { createCardRequest, validCardPayload, createTestCard } from '../../cards/tests/utils.ts';
import type { HonoEnvironment } from '../../context.ts';
import { card, cardPurchaseBatch } from '../../db/schema/cards.ts';
import { ValidationErrorResponseSchema } from '../../schemas/errors.ts';
import { CollectionsSchema, CollectionSummarySchema } from '../schemas/responses.ts';

integrationTest(
  'places all copies in the first empty slot and grows full binders',
  async ({ app, user, authenticatedHeaders: headers }) => {
    const collection = await createBinder(app, headers, 1, 2);
    const first = await addCard(app, user.sessionToken, collection.id);
    const initial = await readCollection(app, headers, collection.id);
    expect(initial.pages).toMatchObject([{ slots: [{ row: 1, column: 1, card_id: first.id, quantity: 3 }] }]);
    expect(initial.revision).toBe(collection.revision + 1);

    const pageId = crypto.randomUUID();
    const emptyId = crypto.randomUUID();
    await saveLayout(app, headers, collection.id, {
      revision: initial.revision,
      rows: 1,
      columns: 2,
      pages: [
        { id: pageId, slots: [{ row: 1, column: 2, card_id: first.id, quantity: 3 }] },
        { id: emptyId, slots: [] },
      ],
    });
    const second = await addCard(app, user.sessionToken, collection.id);
    const third = await addCard(app, user.sessionToken, collection.id);
    const fourth = await addCard(app, user.sessionToken, collection.id);
    const fifth = await addCard(app, user.sessionToken, collection.id);
    const result = await readCollection(app, headers, collection.id);
    expect(result.pages).toMatchObject([
      {
        id: pageId,
        slots: [
          { row: 1, column: 1, card_id: second.id, quantity: 3 },
          { row: 1, column: 2, card_id: first.id, quantity: 3 },
        ],
      },
      {
        id: emptyId,
        slots: [
          { row: 1, column: 1, card_id: third.id, quantity: 3 },
          { row: 1, column: 2, card_id: fourth.id, quantity: 3 },
        ],
      },
      { slots: [{ row: 1, column: 1, card_id: fifth.id, quantity: 3 }] },
    ]);
  },
);

integrationTest(
  'serializes concurrent additions so each entry gets a distinct empty slot',
  async ({ app, user, authenticatedHeaders: headers }) => {
    const collection = await createBinder(app, headers, 2, 2);
    const cards = await Promise.all(Array.from({ length: 4 }, () => addCard(app, user.sessionToken, collection.id)));
    const result = await readCollection(app, headers, collection.id);
    expect(result.pages).toHaveLength(1);
    const slots = result.pages.flatMap(page => page.slots);
    expect(slots.map(slot => [slot.row, slot.column])).toEqual([
      [1, 1],
      [1, 2],
      [2, 1],
      [2, 2],
    ]);
    expect(new Set(slots.map(slot => slot.card_id))).toEqual(new Set(cards.map(entry => entry.id)));
  },
);

integrationTest(
  'places moved cards but preserves intentional gaps when editing the same collection',
  async ({ app, user, authenticatedHeaders: headers }) => {
    const source = await createBinder(app, headers, 1, 2);
    const destination = await createBinder(app, headers, 2, 1);
    const entry = await addCard(app, user.sessionToken, source.id);

    const move = (collectionId: string | null) =>
      app.request(`/app-api/cards/${entry.id}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ ...validCardPayload, collection_id: collectionId }),
      });

    expect((await move(destination.id)).status).toBe(200);
    expect((await readCollection(app, headers, source.id)).pages).toMatchObject([{ slots: [] }]);
    const placed = await readCollection(app, headers, destination.id);
    expect(placed.pages).toMatchObject([{ slots: [{ card_id: entry.id, quantity: 3 }] }]);
    await saveLayout(app, headers, destination.id, {
      revision: placed.revision,
      rows: placed.rows,
      columns: placed.columns,
      pages: placed.pages.map(page => ({ ...page, slots: [] })),
    });
    expect((await move(destination.id)).status).toBe(200);
    expect((await readCollection(app, headers, destination.id)).pages).toMatchObject([{ slots: [] }]);
    expect((await move(null)).status).toBe(200);
    const listed = CollectionsSchema.parse(await (await app.request('/app-api/collections', { headers })).json());
    const unfiled = CollectionSummarySchema.parse(listed.collections.find(collection => collection.is_unfiled));
    expect((await readCollection(app, headers, unfiled.id)).pages).toMatchObject([
      { slots: [{ row: 1, column: 1, card_id: entry.id, quantity: 3 }] },
    ]);
  },
);

integrationTest(
  'rolls back additions and moves into a full binder and allows retry after resizing',
  async ({ db, limitedApp, user, authenticatedHeaders: headers }) => {
    const instance = limitedApp({ COLLECTION_MAX_PAGES: 1 });

    const collection = await createBinder(instance, headers, 1, 1);
    await addCard(instance, user.sessionToken, collection.id);
    const before = await readCollection(instance, headers, collection.id);
    const storedCards = await db.select().from(card).where(eq(card.userId, user.userId));

    const response = await createCardRequest(instance, user.sessionToken, {
      ...validCardPayload,
      collection_id: collection.id,
    });

    expect(response.status).toBe(400);
    expect(ValidationErrorResponseSchema.parse(await response.json()).context?.validations).toMatchObject([
      { code: 'binder_full', path: ['collection_id'] },
    ]);
    expect(await db.select().from(card).where(eq(card.userId, user.userId))).toEqual(storedCards);
    expect(await readCollection(instance, headers, collection.id)).toEqual(before);

    const purchases = await db
      .select()
      .from(cardPurchaseBatch)
      .where(
        inArray(
          cardPurchaseBatch.cardId,
          storedCards.map(entry => entry.id),
        ),
      );

    expect(purchases).toHaveLength(validCardPayload.purchases.length);

    const source = await createBinder(instance, headers, 1, 1);
    const moving = await addCard(instance, user.sessionToken, source.id);

    const move = await instance.request(`/app-api/cards/${moving.id}`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ ...validCardPayload, collection_id: collection.id }),
    });

    expect(move.status).toBe(400);
    expect((await readCollection(instance, headers, source.id)).pages).toMatchObject([
      { slots: [{ card_id: moving.id }] },
    ]);
    await saveLayout(instance, headers, collection.id, {
      revision: before.revision,
      rows: 1,
      columns: 2,
      pages: before.pages,
    });
    const retry = await addCard(instance, user.sessionToken, collection.id);
    expect((await readCollection(instance, headers, collection.id)).pages).toMatchObject([
      {
        slots: [
          { row: 1, column: 1 },
          { row: 1, column: 2, card_id: retry.id },
        ],
      },
    ]);
  },
);

async function createBinder(app: Hono<HonoEnvironment>, headers: Headers, rows: number, columns: number) {
  const collection = await createTestCollection(app, headers);

  return saveLayout(app, headers, collection.id, { revision: collection.revision, rows, columns, pages: [] });
}

async function addCard(app: Hono<HonoEnvironment>, sessionToken: string, collectionId: string) {
  return createTestCard(app, sessionToken, { ...validCardPayload, collection_id: collectionId });
}
