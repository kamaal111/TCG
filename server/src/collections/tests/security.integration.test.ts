import crypto from 'node:crypto';

import { eq, sql } from 'drizzle-orm';
import type { Hono } from 'hono';
import { z } from 'zod';

import { integrationTest } from './fixtures.ts';
import { CardSchema } from '../../cards/schemas/responses.ts';
import { sessionHeaders, createCardRequest, validCardPayload } from '../../cards/tests/utils.ts';
import type { HonoEnvironment } from '../../context.ts';
import { binderPage, card, cardCollection, cardPurchaseBatch } from '../../db/schema/cards.ts';
import { createTestUser } from '../../tests/utils.ts';
import { BackupSchema, CollectionsSchema } from '../schemas/responses.ts';

const EMPTY_BACKUP = { version: 1, collections: [], cards: [] };

const ENDPOINT = '/app-api/collections/import-preview';

const ErrorSchema = z.object({ code: z.string() });

for (const { policy, body } of [
  { policy: { COLLECTION_MAX_COLLECTIONS: 1 }, body: { ...EMPTY_BACKUP, collections: [null, null] } },
  { policy: { COLLECTION_MAX_CARDS: 1 }, body: { ...EMPTY_BACKUP, cards: [null, null] } },
  {
    policy: { COLLECTION_MAX_PAGES: 1 },
    body: { ...EMPTY_BACKUP, collections: [{ pages: [{ slots: [] }, { slots: [] }] }] },
  },
  {
    policy: { COLLECTION_MAX_SLOTS: 1 },
    body: { ...EMPTY_BACKUP, collections: [{ pages: [{ slots: [null, null] }] }] },
  },
  { policy: { COLLECTION_MAX_PURCHASES: 1 }, body: { ...EMPTY_BACKUP, cards: [{ purchases: [null, null] }] } },
]) {
  integrationTest(
    `rejects cumulative count overflow before validating entries or writing data: ${JSON.stringify(policy)}`,
    async ({ app, db, limitedApp }) => {
      const user = await createTestUser(app, db);

      const response = await limitedApp(policy).request(ENDPOINT, {
        method: 'POST',
        headers: sessionHeaders(user.sessionToken),
        body: JSON.stringify(body),
      });

      expect(response.status).toBe(413);
      expect(ErrorSchema.parse(await response.json()).code).toBe('COLLECTION_REQUEST_TOO_LARGE');
      expect(await db.select().from(cardCollection).where(eq(cardCollection.userId, user.userId))).toEqual([]);
    },
  );
}

integrationTest(
  'accepts exactly the UTF-8 byte limit and rejects one additional byte despite a false Content-Length',
  async ({ app, db, limitedApp }) => {
    const user = await createTestUser(app, db);
    const body = JSON.stringify({ ...EMPTY_BACKUP, ignored: 'é' });
    const bytes = Buffer.byteLength(body);
    const instance = limitedApp({ COLLECTION_MAX_BODY_BYTES: bytes });
    const headers = sessionHeaders(user.sessionToken);
    const accepted = await instance.request(ENDPOINT, { method: 'POST', headers, body });
    const falseLengthHeaders = new Headers(headers);
    falseLengthHeaders.set('Content-Length', '1');

    const rejected = await instance.request(ENDPOINT, {
      method: 'POST',
      headers: falseLengthHeaders,
      body: body + ' ',
    });

    expect(accepted.status).toBe(200);
    expect(rejected.status).toBe(413);
  },
);

integrationTest('retains authentication and malformed JSON responses', async ({ app, db, limitedApp }) => {
  const user = await createTestUser(app, db);
  const instance = limitedApp({ COLLECTION_MAX_BODY_BYTES: 1 });
  const unauthorized = await instance.request(ENDPOINT, { method: 'POST', body: 'large' });

  const malformed = await instance.request(ENDPOINT, {
    method: 'POST',
    headers: sessionHeaders(user.sessionToken),
    body: '{',
  });

  expect(unauthorized.status).toBe(401);
  expect(malformed.status).toBe(400);
});

integrationTest('times out a stalled body and releases the body reader capacity', async ({ app, db, limitedApp }) => {
  const user = await createTestUser(app, db);
  const instance = limitedApp({ COLLECTION_BODY_TIMEOUT_MS: 20, COLLECTION_CONCURRENCY: 1 });
  const headers = sessionHeaders(user.sessionToken);

  const init = {
    method: 'POST',
    headers,
    body: new ReadableStream<Uint8Array>(),
    duplex: 'half',
  };

  const stalled = new Request('http://localhost' + ENDPOINT, init);

  const response = await instance.request(stalled);
  const subsequent = await previewRequest(instance, headers);
  expect(response.status).toBe(408);
  expect(subsequent.status).toBe(200);
});

integrationTest(
  'shares account admission across app instances and releases it after a canceled export',
  async ({ app, db, limitedApp }) => {
    const user = await createTestUser(app, db);
    const headers = sessionHeaders(user.sessionToken);
    const first = limitedApp({});
    const second = limitedApp({});
    const exporting = await first.request('/app-api/collections/export', { method: 'POST', headers, body: '{}' });
    const blocked = await previewRequest(second, headers);
    expect(exporting.status).toBe(200);
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get('Retry-After')).toBe('1');
    const stream = z.instanceof(ReadableStream).parse(exporting.body);
    await stream.cancel();
    await expect.poll(async () => (await previewRequest(second, headers)).status).toBe(200);
  },
);

integrationTest(
  'shares global admission across app instances and releases it after export completion',
  async ({ app, db, limitedApp }) => {
    const firstUser = await createTestUser(app, db);
    const secondUser = await createTestUser(app, db);
    const first = limitedApp({ COLLECTION_CONCURRENCY: 1 });
    const second = limitedApp({ COLLECTION_CONCURRENCY: 1 });

    const exporting = await first.request('/app-api/collections/export', {
      method: 'POST',
      headers: sessionHeaders(firstUser.sessionToken),
      body: '{}',
    });

    const headers = sessionHeaders(secondUser.sessionToken);
    const blocked = await previewRequest(second, headers);
    expect(blocked.status).toBe(503);
    expect(blocked.headers.get('Retry-After')).toBe('1');
    expect(BackupSchema.parse(await exporting.json()).version).toBe(1);
    const subsequent = await previewRequest(second, headers);
    expect(subsequent.status).toBe(200);
  },
);

integrationTest(
  'streams 501 collections and 5001 cards without imposing import limits on a full export',
  async ({ app, db, limitedApp }) => {
    const user = await createTestUser(app, db);

    const named = Array.from({ length: 501 }, (_, index) => ({
      id: crypto.randomUUID(),
      userId: user.userId,
      name: `Binder ${index}`,
    }));

    await db.insert(cardCollection).values(named);
    const target = z.object({ id: z.string() }).parse(named[0]);

    const entries = Array.from(
      { length: 5001 },
      () =>
        ({
          id: crypto.randomUUID(),
          userId: user.userId,
          collectionId: target.id,
          game: 'one_piece',
          name: 'Card',
          setName: 'Set',
          cardNumber: '1',
        }) as const,
    );

    for (let start = 0; start < entries.length; start += 500) {
      const batch = entries.slice(start, start + 500);
      await db.insert(card).values(batch);
      await db
        .insert(cardPurchaseBatch)
        .values(batch.map(c => ({ cardId: c.id, condition: 'near_mint', quantity: 1 }) as const));
    }

    const response = await limitedApp({}).request('/app-api/collections/export', {
      method: 'POST',
      headers: sessionHeaders(user.sessionToken),
      body: '{}',
    });

    const backup = BackupSchema.parse(await response.json());
    expect(response.status).toBe(200);
    expect(backup.collections).toHaveLength(502);
    expect(backup.cards).toHaveLength(5001);
    expect(backup.cards.every(c => c.purchases.length === 1 && c.collection_id === target.id)).toBe(true);
  },
  60_000,
);

integrationTest(
  'inserts 501 pages in batches and preserves empty pages at the configured boundary',
  async ({ app, db, limitedApp }) => {
    const user = await createTestUser(app, db);
    const headers = sessionHeaders(user.sessionToken);
    const listed = CollectionsSchema.parse(await (await app.request('/app-api/collections', { headers })).json());
    const collection = z.object({ id: z.string(), revision: z.number() }).parse(listed.collections[0]);
    const pages = Array.from({ length: 501 }, () => ({ id: crypto.randomUUID(), slots: [] }));

    const response = await limitedApp({ COLLECTION_MAX_PAGES: 501 }).request(
      `/app-api/collections/${collection.id}/layout`,
      {
        method: 'PUT',
        headers,
        body: JSON.stringify({ ...collection, columns: 1, rows: 4, pages }),
      },
    );

    expect(response.status).toBe(200);
    expect(await db.select().from(binderPage).where(eq(binderPage.collectionId, collection.id))).toHaveLength(501);
  },
);

integrationTest(
  'a database lock timeout rolls back the import and releases admission',
  async ({ app, db, limitedApp }) => {
    const user = await createTestUser(app, db);
    const headers = sessionHeaders(user.sessionToken);
    const held = Promise.withResolvers<undefined>();
    const release = Promise.withResolvers<undefined>();

    const locking = db.transaction(async tx => {
      await tx.execute(sql`lock table ${cardCollection} in access exclusive mode`);
      held.resolve(undefined);
      await release.promise;
    });

    await held.promise;
    const instance = limitedApp({ COLLECTION_LOCK_TIMEOUT_MS: 20 });
    let response: Response;

    try {
      response = await instance.request('/app-api/collections/import', {
        method: 'POST',
        headers,
        body: JSON.stringify(EMPTY_BACKUP),
      });
    } finally {
      release.resolve(undefined);
      await locking;
    }

    expect(response.status).toBe(503);
    expect(ErrorSchema.parse(await response.json()).code).toBe('COLLECTION_OPERATION_TIMEOUT');
    expect(await db.select().from(cardCollection).where(eq(cardCollection.userId, user.userId))).toEqual([]);

    const subsequent = await instance.request(ENDPOINT, {
      method: 'POST',
      headers,
      body: JSON.stringify(EMPTY_BACKUP),
    });

    expect(subsequent.status).toBe(200);
  },
);

for (const policy of [
  { COLLECTION_STATEMENT_TIMEOUT_MS: 20, COLLECTION_OPERATION_TIMEOUT_MS: 1000 },
  { COLLECTION_STATEMENT_TIMEOUT_MS: 1000, COLLECTION_OPERATION_TIMEOUT_MS: 20 },
]) {
  integrationTest(
    `database deadline rolls back all import writes and leaves a usable pool: ${JSON.stringify(policy)}`,
    async ({ app, db, limitedApp }) => {
      const user = await createTestUser(app, db);
      await db.execute(sql`create function delay_collection() returns trigger language plpgsql as $$
      begin
        if NEW.name = 'Slow' then perform pg_sleep(0.2); end if;
        return NEW;
      end $$`);
      await db.execute(sql`create trigger delay_collection before insert on ${cardCollection}
      for each row execute function delay_collection()`);

      const body = {
        ...EMPTY_BACKUP,
        collections: [
          {
            id: crypto.randomUUID(),
            name: 'Slow',
            is_unfiled: false,
            revision: 0,
            columns: 1,
            rows: 4,
            pages: [],
          },
        ],
      };

      const headers = sessionHeaders(user.sessionToken);

      const response = await limitedApp(policy).request('/app-api/collections/import', {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });

      expect(response.status).toBe(503);
      expect(ErrorSchema.parse(await response.json()).code).toBe('COLLECTION_OPERATION_TIMEOUT');
      expect(await db.select().from(cardCollection).where(eq(cardCollection.userId, user.userId))).toEqual([]);

      const subsequent = await limitedApp({}).request(ENDPOINT, {
        method: 'POST',
        headers,
        body: JSON.stringify(EMPTY_BACKUP),
      });

      expect(subsequent.status).toBe(200);
    },
  );
}

function previewRequest(app: Hono<HonoEnvironment>, headers: Headers) {
  return app.request(ENDPOINT, { method: 'POST', headers, body: JSON.stringify(EMPTY_BACKUP) });
}

integrationTest(
  'accepts a complete backup at every configured count limit and limits submitted export IDs before deduplication',
  async ({ app, db, limitedApp }) => {
    const user = await createTestUser(app, db);
    const headers = sessionHeaders(user.sessionToken);

    const ownedCard = CardSchema.parse(
      await (
        await createCardRequest(app, user.sessionToken, {
          ...validCardPayload,
          purchases: validCardPayload.purchases.slice(0, 1),
        })
      ).json(),
    );

    const listed = CollectionsSchema.parse(await (await app.request('/app-api/collections', { headers })).json());
    const collection = z.object({ id: z.string(), revision: z.number() }).parse(listed.collections[0]);

    const layout = await app.request(`/app-api/collections/${collection.id}/layout`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({
        revision: collection.revision,
        columns: 1,
        rows: 4,
        pages: [{ id: crypto.randomUUID(), slots: [{ row: 1, column: 1, card_id: ownedCard.id, quantity: 1 }] }],
      }),
    });

    expect(layout.status).toBe(200);
    const exported = await app.request('/app-api/collections/export', { method: 'POST', headers, body: '{}' });
    const backup = BackupSchema.parse(await exported.json());

    const instance = limitedApp({
      COLLECTION_MAX_COLLECTIONS: 1,
      COLLECTION_MAX_CARDS: 1,
      COLLECTION_MAX_PAGES: 1,
      COLLECTION_MAX_SLOTS: 1,
      COLLECTION_MAX_PURCHASES: 1,
    });

    const preview = await instance.request(ENDPOINT, { method: 'POST', headers, body: JSON.stringify(backup) });

    const imported = await instance.request('/app-api/collections/import', {
      method: 'POST',
      headers,
      body: JSON.stringify(backup),
    });

    const selected = await instance.request('/app-api/collections/export', {
      method: 'POST',
      headers,
      body: JSON.stringify({ collection_ids: [collection.id] }),
    });

    expect(preview.status).toBe(200);
    expect(imported.status).toBe(200);
    expect(selected.status).toBe(200);
    expect(BackupSchema.parse(await selected.json()).cards).toHaveLength(1);

    const excessive = await instance.request('/app-api/collections/export', {
      method: 'POST',
      headers,
      body: JSON.stringify({ collection_ids: [collection.id, collection.id] }),
    });

    expect(excessive.status).toBe(413);
  },
);
