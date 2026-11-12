import crypto from 'node:crypto';

import { ErrorResponseSchema, ValidationErrorResponseSchema } from '@tcg/http/error-schemas';
import { eq } from 'drizzle-orm';

import { integrationTest } from './fixtures.ts';
import { createTestCollection, readCollection, saveLayout } from './utils.ts';
import { createTestCard, validCardPayload } from '../../cards/tests/utils.ts';
import { card, cardPurchaseBatch } from '../../db/schema/cards.ts';
import { CollectionsSchema, CollectionSummarySchema } from '../schemas/responses.ts';

integrationTest(
  'moves an entire unfiled entry and places only the requested copies in the tapped slot',
  async ({ app, user, authenticatedHeaders: headers, db }) => {
    const entry = await createTestCard(app, user.sessionToken, {
      ...validCardPayload,
      purchases: [{ condition: 'near_mint', quantity: 4, purchase_price: null, currency: null }],
    });

    const destination = await createTestCollection(app, headers);
    const pageId = crypto.randomUUID();

    const layout = await saveLayout(app, headers, destination.id, {
      revision: destination.revision,
      rows: 2,
      columns: 2,
      pages: [{ id: pageId, slots: [] }],
    });

    const listed = CollectionsSchema.parse(await (await app.request('/app-api/collections', { headers })).json());
    const unfiled = CollectionSummarySchema.parse(listed.collections.find(collection => collection.is_unfiled));
    const purchases = await db.select().from(cardPurchaseBatch).where(eq(cardPurchaseBatch.cardId, entry.id));

    const saved = await saveLayout(app, headers, layout.id, {
      ...layout,
      move_from_unfiled_card_id: entry.id,
      pages: [{ id: pageId, slots: [{ row: 1, column: 2, card_id: entry.id, quantity: 1 }] }],
    });

    expect(saved.pages).toEqual([{ id: pageId, slots: [{ row: 1, column: 2, card_id: entry.id, quantity: 1 }] }]);
    expect(saved.revision).toBe(layout.revision + 1);
    expect(await db.select().from(cardPurchaseBatch).where(eq(cardPurchaseBatch.cardId, entry.id))).toEqual(purchases);
    const [moved] = await db.select().from(card).where(eq(card.id, entry.id));
    expect(moved?.collectionId).toBe(destination.id);
    const reloaded = CollectionsSchema.parse(await (await app.request('/app-api/collections', { headers })).json());
    expect(reloaded.collections.find(collection => collection.is_unfiled)?.revision).toBe(unfiled.revision + 1);
    const unfiledLayout = await readCollection(app, headers, unfiled.id);
    expect(unfiledLayout.pages.flatMap(page => page.slots)).toEqual([]);
  },
);

integrationTest(
  'rolls back membership and source placements when the requested quantity exceeds ownership',
  async ({ app, user, authenticatedHeaders: headers }) => {
    const entry = await createTestCard(app, user.sessionToken, validCardPayload);
    const destination = await createTestCollection(app, headers);
    const listed = CollectionsSchema.parse(await (await app.request('/app-api/collections', { headers })).json());
    const unfiled = CollectionSummarySchema.parse(listed.collections.find(collection => collection.is_unfiled));
    const before = await readCollection(app, headers, unfiled.id);

    const response = await app.request(`/app-api/collections/${destination.id}/layout`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({
        ...destination,
        move_from_unfiled_card_id: entry.id,
        pages: [{ id: crypto.randomUUID(), slots: [{ row: 1, column: 1, card_id: entry.id, quantity: 99 }] }],
      }),
    });

    expect(response.status).toBe(409);
    expect(ErrorResponseSchema.parse(await response.json()).code).toBe('COLLECTION_CONFLICT');
    expect(await readCollection(app, headers, before.id)).toEqual(before);
    expect(await readCollection(app, headers, destination.id)).toEqual(destination);
  },
);

integrationTest(
  'rejects stale layout saves before moving an unfiled entry',
  async ({ app, user, authenticatedHeaders: headers, db }) => {
    const entry = await createTestCard(app, user.sessionToken, validCardPayload);
    const destination = await createTestCollection(app, headers);
    const latest = await saveLayout(app, headers, destination.id, { ...destination, pages: [] });

    const response = await app.request(`/app-api/collections/${destination.id}/layout`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({
        ...destination,
        move_from_unfiled_card_id: entry.id,
        pages: [{ id: crypto.randomUUID(), slots: [{ row: 1, column: 1, card_id: entry.id, quantity: 1 }] }],
      }),
    });

    expect(response.status).toBe(409);
    expect(ErrorResponseSchema.parse(await response.json()).code).toBe('COLLECTION_CONFLICT');
    expect(await readCollection(app, headers, destination.id)).toEqual(latest);
    const [stored] = await db.select().from(card).where(eq(card.id, entry.id));
    expect(stored?.collectionId).toBeNull();
  },
);

integrationTest(
  'does not steal an entry that already belongs to a named collection',
  async ({ app, user, authenticatedHeaders: headers }) => {
    const source = await createTestCollection(app, headers);
    const entry = await createTestCard(app, user.sessionToken, { ...validCardPayload, collection_id: source.id });
    const before = await readCollection(app, headers, source.id);
    const destination = await createTestCollection(app, headers);

    const response = await app.request(`/app-api/collections/${destination.id}/layout`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({
        ...destination,
        move_from_unfiled_card_id: entry.id,
        pages: [{ id: crypto.randomUUID(), slots: [{ row: 1, column: 1, card_id: entry.id, quantity: 1 }] }],
      }),
    });

    expect(response.status).toBe(409);
    expect(ErrorResponseSchema.parse(await response.json()).code).toBe('COLLECTION_CONFLICT');
    expect(await readCollection(app, headers, source.id)).toEqual(before);
    expect(await readCollection(app, headers, destination.id)).toEqual(destination);
  },
);

integrationTest(
  'rejects another account card without changing either collection',
  async ({ app, createUser, authenticatedHeaders: headers }) => {
    const other = await createUser();
    const entry = await createTestCard(app, other.sessionToken, validCardPayload);
    const destination = await createTestCollection(app, headers);

    const response = await app.request(`/app-api/collections/${destination.id}/layout`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({
        ...destination,
        move_from_unfiled_card_id: entry.id,
        pages: [{ id: crypto.randomUUID(), slots: [{ row: 1, column: 1, card_id: entry.id, quantity: 1 }] }],
      }),
    });

    expect(response.status).toBe(404);
    expect(ErrorResponseSchema.parse(await response.json()).code).toBe('COLLECTION_NOT_FOUND');
    expect(await readCollection(app, headers, destination.id)).toEqual(destination);
  },
);

integrationTest(
  'requires the moved card to occupy a slot and validates its identifier',
  async ({ app, authenticatedHeaders: headers }) => {
    const destination = await createTestCollection(app, headers);

    const missingSlot = await app.request(`/app-api/collections/${destination.id}/layout`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ ...destination, move_from_unfiled_card_id: crypto.randomUUID(), pages: [] }),
    });

    expect(missingSlot.status).toBe(400);
    expect(ValidationErrorResponseSchema.parse(await missingSlot.json()).context?.validations).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: ['move_from_unfiled_card_id'] })]),
    );

    const malformed = await app.request(`/app-api/collections/${destination.id}/layout`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ ...destination, move_from_unfiled_card_id: 'invalid', pages: [] }),
    });

    expect(malformed.status).toBe(400);
    expect(ValidationErrorResponseSchema.parse(await malformed.json()).context?.validations).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: ['move_from_unfiled_card_id'] })]),
    );
  },
);

integrationTest(
  'requires authentication for an unfiled placement',
  async ({ app, user, authenticatedHeaders: headers }) => {
    const entry = await createTestCard(app, user.sessionToken, validCardPayload);
    const destination = await createTestCollection(app, headers);

    const response = await app.request(`/app-api/collections/${destination.id}/layout`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...destination,
        move_from_unfiled_card_id: entry.id,
        pages: [{ id: crypto.randomUUID(), slots: [{ row: 1, column: 1, card_id: entry.id, quantity: 1 }] }],
      }),
    });

    expect(response.status).toBe(401);
    expect(ErrorResponseSchema.parse(await response.json()).message).toBeTruthy();
    expect(await readCollection(app, headers, destination.id)).toEqual(destination);
  },
);
