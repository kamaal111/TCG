import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import { CONTENTFUL_STATUS_CODES } from '@tcg/http/status';
import { eq, sql } from 'drizzle-orm';

import { createCardRequest, csvImportPayload, validCardPayload, requestOwnedPrices } from './utils.ts';
import { card, cardPurchaseBatch } from '../../db/schema/cards.ts';
import { integrationTest } from '../../tests/fixtures.ts';
import { EXPORT_CARDS_ROUTE_PATH } from '../routes/export-cards.ts';
import { IMPORT_CARDS_ROUTE_PATH } from '../routes/import-cards.ts';
import { LIST_CARDS_ROUTE_PATH } from '../routes/list-cards.ts';
import {
  CardSchema,
  CardsListResponseSchema,
  ExportCardsResponseSchema,
  OwnedCardPricesSchema,
} from '../schemas/responses.ts';

for (const [path, schema] of [
  [LIST_CARDS_ROUTE_PATH, CardsListResponseSchema],
  [EXPORT_CARDS_ROUTE_PATH, ExportCardsResponseSchema],
] as const) {
  describe(`Card pagination at ${path}`, () => {
    integrationTest(
      'returns bounded pages, preserving timestamp precision and deleted anchors',
      async ({ app, db, user, authenticatedHeaders }) => {
        const ids: string[] = [];

        for (let index = 0; index < 3; index += 1) {
          const response = await createCardRequest(app, user.sessionToken, validCardPayload);
          expect(response.status).toBe(CONTENTFUL_STATUS_CODES.CREATED);
          const created = CardSchema.parse(await response.json());
          ids.push(created.id);
          await db.execute(
            sql`update ${card} set created_at = ${`2026-07-20 10:30:00.00000${index + 1}`}::timestamp where id = ${created.id}`,
          );
        }

        const first = await app.request(`${path}?limit=2`, { headers: authenticatedHeaders });
        expect(first.status).toBe(CONTENTFUL_STATUS_CODES.OK);
        const page = schema.parse(await first.json());
        expect(page.entries.map(entry => entry.id)).toEqual([ids[2], ids[1]]);
        expect(page.next_cursor).toEqual(expect.any(String));
        assert(ids[1] != null);
        assert(page.next_cursor != null);
        await db.delete(card).where(eq(card.id, ids[1]));

        const second = await app.request(`${path}?limit=2&cursor=${encodeURIComponent(page.next_cursor)}`, {
          headers: authenticatedHeaders,
        });

        expect(second.status).toBe(CONTENTFUL_STATUS_CODES.OK);
        expect(schema.parse(await second.json())).toMatchObject({ entries: [{ id: ids[0] }], next_cursor: null });
      },
    );

    integrationTest(
      'orders identical timestamps by ID without dropping cards',
      async ({ app, db, user, createUser, authenticatedHeaders }) => {
        const other = await createUser();
        const ids: string[] = [];

        for (let index = 0; index < 3; index += 1) {
          const response = await createCardRequest(app, user.sessionToken, validCardPayload);
          ids.push(CardSchema.parse(await response.json()).id);
        }

        await createCardRequest(app, other.sessionToken, validCardPayload);
        await db
          .update(card)
          .set({ createdAt: new Date('2026-07-20T10:30:00.000Z') })
          .where(eq(card.userId, user.userId));
        const collected: string[] = [];
        let cursor: string | null = null;

        do {
          const response = await app.request(
            `${path}?limit=1${cursor == null ? '' : `&cursor=${encodeURIComponent(cursor)}`}`,
            {
              headers: authenticatedHeaders,
            },
          );

          expect(response.status).toBe(CONTENTFUL_STATUS_CODES.OK);
          const page = schema.parse(await response.json());
          collected.push(...page.entries.map(entry => entry.id));
          cursor = page.next_cursor;
        } while (cursor != null);

        expect(collected).toEqual(ids.toSorted().toReversed());
      },
    );

    for (const query of ['limit=0', 'limit=101', 'limit=1.5', 'limit=nope', 'cursor=invalid', 'cursor=']) {
      integrationTest(`rejects invalid pagination: ${query}`, async ({ app, authenticatedHeaders }) => {
        const response = await app.request(`${path}?${query}`, { headers: authenticatedHeaders });
        expect(response.status).toBe(CONTENTFUL_STATUS_CODES.BAD_REQUEST);
        expect(await response.json()).toMatchObject({ code: 'INVALID_PAYLOAD' });
      });
    }

    integrationTest(
      'returns internal repository failures as 500 instead of invalid input',
      async ({ app, db, authenticatedHeaders }) => {
        await db.execute(sql`alter table ${card} rename column created_at to broken_created_at`);
        const response = await app.request(path, { headers: authenticatedHeaders });
        expect(response.status).toBe(CONTENTFUL_STATUS_CODES.INTERNAL_SERVER_ERROR);
        expect(await response.json()).toEqual({ message: 'Something went wrong', code: 'INTERNAL_SERVER_ERROR' });
      },
    );

    integrationTest('ends empty collections with a null cursor', async ({ app, authenticatedHeaders }) => {
      const response = await app.request(path, { headers: authenticatedHeaders });
      expect(schema.parse(await response.json())).toMatchObject({ entries: [], next_cursor: null });
    });
  });
}

integrationTest(
  'returns complete game-scoped set choices on every filtered page',
  async ({ app, user, authenticatedHeaders }) => {
    for (const setName of ['Base Set', 'Base Set', 'Crown Zenith']) {
      await createCardRequest(app, user.sessionToken, { ...validCardPayload, game: 'pokemon', set_name: setName });
    }

    await createCardRequest(app, user.sessionToken, validCardPayload);
    const path = `${LIST_CARDS_ROUTE_PATH}?game=pokemon&set_name=Base%20Set&limit=1`;

    const first = CardsListResponseSchema.parse(
      await (await app.request(path, { headers: authenticatedHeaders })).json(),
    );

    expect(first.available_set_names).toEqual(['Base Set', 'Crown Zenith']);
    expect(first.entries).toHaveLength(1);
    assert(first.next_cursor != null);

    const second = CardsListResponseSchema.parse(
      await (
        await app.request(`${path}&cursor=${encodeURIComponent(first.next_cursor)}`, {
          headers: authenticatedHeaders,
        })
      ).json(),
    );

    expect(second.available_set_names).toEqual(first.available_set_names);
    expect(second.entries).toHaveLength(1);
    expect(second.next_cursor).toBeNull();
  },
);

integrationTest(
  'defaults to 50 cards, caps requests at 100, and prices only the explicitly requested cards',
  async ({ app, db, authenticatedHeaders }) => {
    const cards = Array.from({ length: 103 }, (_, index) => ({
      id: crypto.randomUUID(),
      ...validCardPayload,
      name: `Monkey D. Luffy ${index}`,
      notes: null,
      created_at: '2026-07-20T10:30:00.000Z',
      updated_at: '2026-07-20T10:30:00.000Z',
      purchases: [
        {
          id: crypto.randomUUID(),
          condition: 'near_mint',
          quantity: 1,
          purchase_price: null,
          currency: null,
          automatic_price_date: null,
        },
      ],
    }));

    const imported = await app.request(IMPORT_CARDS_ROUTE_PATH, {
      method: 'POST',
      headers: authenticatedHeaders,
      body: JSON.stringify(await csvImportPayload(db, cards, 'scrydex_static')),
    });

    expect(imported.status).toBe(CONTENTFUL_STATUS_CODES.OK);

    const defaultExport = ExportCardsResponseSchema.parse(
      await (await app.request(EXPORT_CARDS_ROUTE_PATH, { headers: authenticatedHeaders })).json(),
    );

    expect(defaultExport.entries).toHaveLength(50);
    expect(defaultExport.next_cursor).toEqual(expect.any(String));

    const maximum = ExportCardsResponseSchema.parse(
      await (await app.request(`${EXPORT_CARDS_ROUTE_PATH}?limit=100`, { headers: authenticatedHeaders })).json(),
    );

    expect(maximum.entries).toHaveLength(100);
    assert(maximum.next_cursor != null);

    const remainder = ExportCardsResponseSchema.parse(
      await (
        await app.request(`${EXPORT_CARDS_ROUTE_PATH}?limit=100&cursor=${encodeURIComponent(maximum.next_cursor)}`, {
          headers: authenticatedHeaders,
        })
      ).json(),
    );

    expect(remainder.entries).toHaveLength(3);
    expect(remainder.next_cursor).toBeNull();
    expect(new Set([...maximum.entries, ...remainder.entries].map(entry => entry.id)).size).toBe(103);
    expect((await db.select().from(cardPurchaseBatch)).every(batch => batch.purchasePrice == null)).toBe(true);

    const listed = CardsListResponseSchema.parse(
      await (await app.request(`${LIST_CARDS_ROUTE_PATH}?limit=50`, { headers: authenticatedHeaders })).json(),
    );

    expect(listed.entries).toHaveLength(50);
    expect((await db.select().from(cardPurchaseBatch)).every(batch => batch.purchasePrice == null)).toBe(true);

    const refresh = await requestOwnedPrices(
      app,
      authenticatedHeaders,
      listed.entries.map(card => card.id),
    );

    expect(refresh.status).toBe(200);
    expect(OwnedCardPricesSchema.parse(await refresh.json()).prices).toHaveLength(50);
    const pricedBatches = await db.select().from(cardPurchaseBatch);
    expect(pricedBatches.filter(batch => batch.purchasePrice != null)).toHaveLength(50);
  },
);
