import crypto from 'node:crypto';

import { readCollection } from './utils.ts';
import { CardSchema } from '../../cards/schemas/responses.ts';
import { sessionHeaders, createCardRequest, validCardPayload } from '../../cards/tests/utils.ts';
import { integrationTest } from '../../tests/fixtures.ts';
import { createTestUser } from '../../tests/utils.ts';
import { BackupSchema, CollectionSchema, CollectionsSchema, CollectionSummarySchema } from '../schemas/responses.ts';

integrationTest(
  'allocates four copies across slots, rejects a fifth and preserves empty pages',
  async ({ app, db }) => {
    const user = await createTestUser(app, db);
    const headers = sessionHeaders(user.sessionToken);

    const created = await app.request('/app-api/collections', {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: 'Favorites' }),
    });

    expect(created.status).toBe(201);
    const collection = CollectionSchema.parse(await created.json());

    const cardResponse = await createCardRequest(app, user.sessionToken, {
      ...validCardPayload,
      collection_id: collection.id.toUpperCase(),
      purchases: [{ condition: 'near_mint', quantity: 4, purchase_price: null, currency: null }],
    });

    expect(cardResponse.status).toBe(201);
    const card = CardSchema.parse(await cardResponse.json());

    const latest = await readCollection(app, headers, collection.id);

    const page = {
      id: crypto.randomUUID(),
      slots: [
        { row: 1, column: 1, card_id: card.id, quantity: 3 },
        { row: 2, column: 1, card_id: card.id, quantity: 1 },
      ],
    };

    const empty = { id: crypto.randomUUID(), slots: [] };

    const saved = await app.request(`/app-api/collections/${collection.id}/layout`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({
        revision: latest.revision,
        columns: 1,
        rows: 4,
        pages: [
          {
            ...page,
            id: page.id.toUpperCase(),
            slots: page.slots.map(slot => ({ ...slot, card_id: slot.card_id.toUpperCase() })),
          },
          { ...empty, id: empty.id.toUpperCase() },
        ],
      }),
    });

    expect(saved.status).toBe(200);
    const result = CollectionSchema.parse(await saved.json());
    expect(result).toMatchObject({ columns: 1, rows: 4, pages: [page, empty] });

    const pageResponse = await app.request(`/app-api/collections/${collection.id}/pages/${page.id.toUpperCase()}`, {
      headers,
    });

    expect(pageResponse.status).toBe(200);
    expect(await pageResponse.json()).toMatchObject({ cards: [{ id: card.id }] });
    const emptyPageResponse = await app.request(`/app-api/collections/${collection.id}/pages/${empty.id}`, { headers });
    expect(emptyPageResponse.status).toBe(200);
    expect(await emptyPageResponse.json()).toEqual({ cards: [] });

    const excessive = await app.request(`/app-api/collections/${collection.id}/layout`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({
        revision: result.revision,
        columns: 1,
        rows: 4,
        pages: [{ ...page, slots: [...page.slots, { row: 3, column: 1, card_id: card.id, quantity: 1 }] }, empty],
      }),
    });

    expect(excessive.status).toBe(409);
    expect(await readCollection(app, headers, collection.id)).toEqual(result);
  },
);

integrationTest(
  'reducing owned copies trims later slots and deleting a collection preserves cards in Unfiled',
  async ({ app, db }) => {
    const user = await createTestUser(app, db);
    const headers = sessionHeaders(user.sessionToken);

    const collection = CollectionSchema.parse(
      await (
        await app.request('/app-api/collections', {
          method: 'POST',
          headers,
          body: JSON.stringify({ name: 'Favorites' }),
        })
      ).json(),
    );

    const card = CardSchema.parse(
      await (
        await createCardRequest(app, user.sessionToken, {
          ...validCardPayload,
          collection_id: collection.id,
          purchases: [{ condition: 'near_mint', quantity: 4, purchase_price: null, currency: null }],
        })
      ).json(),
    );

    const current = await readCollection(app, headers, collection.id);

    const pageId = crypto.randomUUID();
    expect(
      (
        await app.request(`/app-api/collections/${collection.id}/layout`, {
          method: 'PUT',
          headers,
          body: JSON.stringify({
            revision: current.revision,
            columns: 2,
            rows: 2,
            pages: [
              {
                id: pageId,
                slots: [
                  { row: 1, column: 1, card_id: card.id, quantity: 3 },
                  { row: 1, column: 2, card_id: card.id, quantity: 1 },
                ],
              },
            ],
          }),
        })
      ).status,
    ).toBe(200);

    const reduced = await app.request(`/app-api/cards/${card.id}`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({
        ...validCardPayload,
        purchases: [{ condition: 'near_mint', quantity: 2, purchase_price: null, currency: null }],
      }),
    });

    expect(reduced.status).toBe(200);
    expect(CardSchema.parse(await reduced.json()).allocation_adjustments).toBe(2);
    expect((await readCollection(app, headers, collection.id)).pages).toEqual([
      { id: pageId, slots: [{ row: 1, column: 1, card_id: card.id, quantity: 2 }] },
    ]);
    expect((await app.request(`/app-api/collections/${collection.id}`, { method: 'DELETE', headers })).status).toBe(
      200,
    );
    const persisted = await db.query.card.findFirst({ where: { id: card.id } });
    expect(persisted).toMatchObject({ collectionId: null });
    expect(await db.query.cardPurchaseBatch.findMany({ where: { cardId: card.id } })).toHaveLength(1);
  },
);

integrationTest(
  'backs up selected collections together and merges repeated imports without duplicates',
  async ({ app, db, getLogsForRequestId, withRequestId }) => {
    const user = await createTestUser(app, db);
    const headers = sessionHeaders(user.sessionToken);

    const collection = CollectionSchema.parse(
      await (
        await app.request('/app-api/collections', {
          method: 'POST',
          headers,
          body: JSON.stringify({ name: 'Favorites' }),
        })
      ).json(),
    );

    const card = CardSchema.parse(
      await (
        await createCardRequest(app, user.sessionToken, { ...validCardPayload, collection_id: collection.id })
      ).json(),
    );

    const current = await readCollection(app, headers, collection.id);

    expect(
      (
        await app.request(`/app-api/collections/${collection.id}/layout`, {
          method: 'PUT',
          headers,
          body: JSON.stringify({
            revision: current.revision,
            columns: 4,
            rows: 1,
            pages: [
              { id: crypto.randomUUID(), slots: [{ row: 1, column: 3, card_id: card.id, quantity: 2 }] },
              { id: crypto.randomUUID(), slots: [] },
            ],
          }),
        })
      ).status,
    ).toBe(200);

    const { headers: exportHeaders, requestId } = withRequestId(headers);

    const exported = await app.request('/app-api/collections/export', {
      method: 'POST',
      headers: exportHeaders,
      body: JSON.stringify({ collection_ids: [collection.id] }),
    });

    const exportBody = await exported.json();
    expect(getLogsForRequestId(requestId).filter(log => log.level === 50)).toEqual([]);
    expect(exportBody).toEqual(expect.objectContaining({ version: 1 }));
    expect(exported.status).toBe(200);
    const backup = BackupSchema.parse(exportBody);

    expect(backup.collections).toHaveLength(1);
    expect(backup.cards.map(c => c.id)).toEqual([card.id]);
    const recipient = await createTestUser(app, db);
    const recipientHeaders = sessionHeaders(recipient.sessionToken);

    const preview = await app.request('/app-api/collections/import-preview', {
      method: 'POST',
      headers: recipientHeaders,
      body: JSON.stringify(backup),
    });

    expect(preview.status).toBe(200);
    expect(await preview.json()).toEqual({
      new_collection_count: 1,
      updated_collection_count: 0,
      new_card_count: 1,
      updated_card_count: 0,
      moved_card_count: 0,
    });
    expect(await db.query.card.findMany({ where: { userId: recipient.userId } })).toHaveLength(0);
    expect(
      (
        await app.request('/app-api/collections/import', {
          method: 'POST',
          headers: recipientHeaders,
          body: JSON.stringify(backup),
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await app.request('/app-api/collections/import', {
          method: 'POST',
          headers: recipientHeaders,
          body: JSON.stringify(backup),
        })
      ).status,
    ).toBe(200);

    const restored = CollectionsSchema.parse(
      await (await app.request('/app-api/collections', { headers: recipientHeaders })).json(),
    );

    expect(restored.collections).toHaveLength(2);
    const favorite = CollectionSummarySchema.parse(restored.collections.find(c => c.name === 'Favorites'));
    expect(await readCollection(app, recipientHeaders, favorite.id)).toMatchObject({
      columns: 4,
      rows: 1,
      pages: [{ slots: [{ row: 1, column: 3, quantity: 2 }] }, { slots: [] }],
    });
    expect(await db.query.card.findMany({ where: { userId: recipient.userId } })).toHaveLength(1);
  },
);

integrationTest('rejects foreign collection access, invalid coordinates and stale revisions', async ({ app, db }) => {
  const owner = await createTestUser(app, db);
  const other = await createTestUser(app, db);
  const headers = sessionHeaders(owner.sessionToken);

  const collection = CollectionSchema.parse(
    await (
      await app.request('/app-api/collections', { method: 'POST', headers, body: JSON.stringify({ name: 'Private' }) })
    ).json(),
  );

  expect(
    (
      await app.request(`/app-api/collections/${collection.id}`, {
        method: 'PATCH',
        headers: sessionHeaders(other.sessionToken),
        body: JSON.stringify({ revision: 0, name: 'Inaccessible' }),
      })
    ).status,
  ).toBe(404);
  expect(
    (await app.request(`/app-api/collections/${collection.id}`, { headers: sessionHeaders(other.sessionToken) }))
      .status,
  ).toBe(404);
  expect((await app.request(`/app-api/collections/${collection.id}`, { method: 'PATCH' })).status).toBe(401);
  expect(
    (
      await app.request(`/app-api/collections/${collection.id}/layout`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ revision: 0, columns: 0, rows: 4, pages: [] }),
      })
    ).status,
  ).toBe(400);

  const results = await Promise.all(
    ['First', 'Second'].map(async name =>
      app.request(`/app-api/collections/${collection.id}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ revision: 0, name }),
      }),
    ),
  );

  expect(results.map(r => r.status).sort((a, b) => a - b)).toEqual([200, 409]);
});

integrationTest(
  'moving a card clears its old slots without compacting the page and scopes collection lists',
  async ({ app, db }) => {
    const user = await createTestUser(app, db);
    const headers = sessionHeaders(user.sessionToken);

    const collection = CollectionSchema.parse(
      await (
        await app.request('/app-api/collections', { method: 'POST', headers, body: JSON.stringify({ name: 'Binder' }) })
      ).json(),
    );

    const card = CardSchema.parse(
      await (
        await createCardRequest(app, user.sessionToken, { ...validCardPayload, collection_id: collection.id })
      ).json(),
    );

    const current = await readCollection(app, headers, collection.id);

    const pageId = crypto.randomUUID();
    expect(
      (
        await app.request(`/app-api/collections/${collection.id}/layout`, {
          method: 'PUT',
          headers,
          body: JSON.stringify({
            revision: current.revision,
            columns: 1,
            rows: 4,
            pages: [{ id: pageId, slots: [{ row: 4, column: 1, card_id: card.id, quantity: 1 }] }],
          }),
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await app.request(`/app-api/cards/${card.id}`, {
          method: 'PUT',
          headers,
          body: JSON.stringify({ ...validCardPayload, collection_id: null }),
        })
      ).status,
    ).toBe(200);
    expect((await readCollection(app, headers, collection.id)).pages).toEqual([{ id: pageId, slots: [] }]);
    const list = await (await app.request(`/app-api/cards?collection_id=${collection.id}`, { headers })).json();
    expect(list).toMatchObject({ cards: [], available_set_names: [] });
  },
);

integrationTest('concurrent layout writes cannot allocate copies twice', async ({ app, db }) => {
  const user = await createTestUser(app, db);
  const headers = sessionHeaders(user.sessionToken);

  const collection = CollectionSchema.parse(
    await (
      await app.request('/app-api/collections', { method: 'POST', headers, body: JSON.stringify({ name: 'Binder' }) })
    ).json(),
  );

  const card = CardSchema.parse(
    await (
      await createCardRequest(app, user.sessionToken, { ...validCardPayload, collection_id: collection.id })
    ).json(),
  );

  const current = await readCollection(app, headers, collection.id);

  const layout = {
    revision: current.revision,
    columns: 2,
    rows: 1,
    pages: [{ id: crypto.randomUUID(), slots: [{ row: 1, column: 1, card_id: card.id, quantity: 3 }] }],
  };

  const responses = await Promise.all(
    [1, 2].map(async () =>
      app.request(`/app-api/collections/${collection.id}/layout`, {
        method: 'PUT',
        headers,
        body: JSON.stringify(layout),
      }),
    ),
  );

  const statuses = responses.map(response => response.status).sort((a, b) => a - b);
  expect(statuses[0]).toBe(200);
  expect([409, 429]).toContain(statuses[1]);
  expect((await readCollection(app, headers, collection.id)).pages).toEqual(layout.pages);
});

integrationTest('a rejected complete backup writes neither collections nor cards', async ({ app, db }) => {
  const user = await createTestUser(app, db);
  const headers = sessionHeaders(user.sessionToken);
  const collectionId = crypto.randomUUID();

  const response = await app.request('/app-api/collections/import', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      version: 1,
      collections: [
        {
          id: collectionId,
          name: 'Broken',
          is_unfiled: false,
          revision: 0,
          columns: 1,
          rows: 4,
          pages: [
            { id: crypto.randomUUID(), slots: [{ row: 1, column: 1, card_id: crypto.randomUUID(), quantity: 1 }] },
          ],
        },
      ],
      cards: [],
    }),
  });

  expect(response.status).toBe(400);
  const collections = CollectionsSchema.parse(await (await app.request('/app-api/collections', { headers })).json());
  expect(collections.collections).toHaveLength(1);
  expect(collections.collections[0]).toMatchObject({ is_unfiled: true });
  expect(await db.query.card.findMany({ where: { userId: user.userId } })).toEqual([]);
});

integrationTest('a late restore conflict rolls back earlier collection writes', async ({ app, db }) => {
  const user = await createTestUser(app, db);
  const headers = sessionHeaders(user.sessionToken);
  const initial = CollectionsSchema.parse(await (await app.request('/app-api/collections', { headers })).json());
  const unfiled = initial.collections[0];
  expect(unfiled).toBeDefined();
  const defaultCollection = await readCollection(app, headers, CollectionSummarySchema.parse(unfiled).id);

  const response = await app.request('/app-api/collections/import', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      version: 1,
      collections: [
        { ...defaultCollection, id: crypto.randomUUID(), is_unfiled: false, name: 'Must roll back' },
        { ...defaultCollection, is_unfiled: false, name: 'Cannot replace Unfiled' },
      ],
      cards: [],
    }),
  });

  expect(response.status).toBe(409);
  expect(CollectionsSchema.parse(await (await app.request('/app-api/collections', { headers })).json())).toEqual(
    initial,
  );
});

integrationTest('page identity collisions never overwrite another account layout', async ({ app, db }) => {
  const owner = await createTestUser(app, db);
  const other = await createTestUser(app, db);
  const headers = sessionHeaders(owner.sessionToken);
  const otherHeaders = sessionHeaders(other.sessionToken);

  const owned = CollectionSchema.parse(
    await (
      await app.request('/app-api/collections', {
        method: 'POST',
        headers,
        body: JSON.stringify({ name: 'Private binder' }),
      })
    ).json(),
  );

  const foreign = CollectionSchema.parse(
    await (
      await app.request('/app-api/collections', {
        method: 'POST',
        headers: otherHeaders,
        body: JSON.stringify({ name: 'Other binder' }),
      })
    ).json(),
  );

  const pageId = crypto.randomUUID();
  const payload = { revision: 0, columns: 1, rows: 4, pages: [{ id: pageId, slots: [] }] };
  expect(
    (
      await app.request(`/app-api/collections/${owned.id}/layout`, {
        method: 'PUT',
        headers,
        body: JSON.stringify(payload),
      })
    ).status,
  ).toBe(200);
  expect(
    (
      await app.request(`/app-api/collections/${foreign.id}/layout`, {
        method: 'PUT',
        headers: otherHeaders,
        body: JSON.stringify(payload),
      })
    ).status,
  ).toBe(404);
  expect((await readCollection(app, headers, owned.id)).pages).toEqual(payload.pages);
  expect((await readCollection(app, otherHeaders, foreign.id)).pages).toEqual([]);
});

for (const dimensions of [
  { columns: 20, rows: 20, status: 200, stored: { columns: 20, rows: 20 } },
  { columns: 21, rows: 20, status: 400, stored: { columns: 3, rows: 3 } },
  { columns: 20, rows: 21, status: 400, stored: { columns: 3, rows: 3 } },
]) {
  integrationTest(
    `validates binder dimensions ${dimensions.columns} by ${dimensions.rows} with status ${dimensions.status}`,
    async ({ app, db }) => {
      const user = await createTestUser(app, db);
      const headers = sessionHeaders(user.sessionToken);
      const listed = CollectionsSchema.parse(await (await app.request('/app-api/collections', { headers })).json());
      const collection = CollectionSummarySchema.parse(listed.collections[0]);

      const response = await app.request(`/app-api/collections/${collection.id}/layout`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({
          revision: collection.revision,
          columns: dimensions.columns,
          rows: dimensions.rows,
          pages: [],
        }),
      });

      expect(response.status).toBe(dimensions.status);
      const stored = await readCollection(app, headers, collection.id);
      expect({ columns: stored.columns, rows: stored.rows }).toEqual(dimensions.stored);
    },
  );
}
