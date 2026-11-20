import assert from 'node:assert/strict';

import { CONTENTFUL_STATUS_CODES } from '@tcg/http/status';
import { eq, sql } from 'drizzle-orm';

import { createCardRequest, csvImportPayload, seedCatalogPrinting, validCardPayload } from './utils.ts';
import { createTestScrydexClient } from '../../card-pricing/tests/utils.ts';
import { card, cardPurchaseBatch } from '../../db/schema/cards.ts';
import { sessionHeaders } from '../../tests/auth.ts';
import { integrationTest } from '../../tests/fixtures.ts';
import { createTestRequestId } from '../../tests/logs.ts';
import { EXPORT_CARDS_ROUTE_PATH } from '../routes/export-cards.ts';
import { IMPORT_CARDS_ROUTE_PATH } from '../routes/import-cards.ts';
import { ExportCardsResponseSchema, ImportCardsResponseSchema } from '../schemas/responses.ts';

const backupCard = {
  id: '550e8400-e29b-41d4-a716-446655440000',
  game: 'one_piece' as const,
  name: 'Monkey D. Luffy',
  set_name: 'Romance Dawn',
  card_number: 'OP01-003',
  notes: 'Foil',
  created_at: '2026-07-20T10:30:00.000Z',
  updated_at: '2026-07-20T10:30:00.000Z',
  purchases: [
    {
      id: '550e8400-e29b-41d4-a716-446655440001',
      condition: 'near_mint',
      quantity: 2,
      purchase_price: '2.50',
      currency: 'USD',
      automatic_price_date: '2026-07-20',
    },
    {
      id: '550e8400-e29b-41d4-a716-446655440002',
      condition: 'played',
      quantity: 1,
      purchase_price: null,
      currency: null,
      automatic_price_date: null,
    },
  ],
};

describe('Card CSV import and export integration', () => {
  integrationTest('requires authentication for both operations', async ({ app }) => {
    expect((await app.request(EXPORT_CARDS_ROUTE_PATH)).status).toBe(CONTENTFUL_STATUS_CODES.UNAUTHORIZED);
    expect((await app.request(IMPORT_CARDS_ROUTE_PATH, { method: 'POST' })).status).toBe(
      CONTENTFUL_STATUS_CODES.UNAUTHORIZED,
    );
  });

  integrationTest(
    'imports purchases and timestamps and skips repeat imports',
    async ({ app, db, user, authenticatedHeaders }) => {
      const request = async () => {
        return app.request(IMPORT_CARDS_ROUTE_PATH, {
          method: 'POST',
          headers: authenticatedHeaders,
          body: JSON.stringify(await csvImportPayload(db, [backupCard], 'scrydex_static')),
        });
      };

      const response = await request();
      expect(response.status).toBe(CONTENTFUL_STATUS_CODES.OK);
      expect(ImportCardsResponseSchema.parse(await response.json())).toEqual({
        imported_count: 1,
        updated_count: 0,
        skipped_count: 0,
      });
      expect(ImportCardsResponseSchema.parse(await (await request()).json())).toEqual({
        imported_count: 0,
        updated_count: 0,
        skipped_count: 1,
      });
      const exported = await app.request(EXPORT_CARDS_ROUTE_PATH, { headers: authenticatedHeaders });
      expect(exported.status).toBe(CONTENTFUL_STATUS_CODES.OK);
      expect(ExportCardsResponseSchema.parse(await exported.json()).entries).toEqual([
        expect.objectContaining({
          ...backupCard,
          purchases: expect.arrayContaining([
            expect.objectContaining({
              condition: 'near_mint',
              quantity: 2,
              purchase_price: '2.500000',
              currency: 'USD',
              automatic_price_date: '2026-07-20',
            }),
            expect.objectContaining({ condition: 'played', quantity: 1, purchase_price: null, currency: null }),
          ]),
        }),
      ]);
      const stored = await db.query.card.findFirst({ where: { userId: user.userId }, with: { purchaseBatches: true } });
      expect(stored?.id).not.toBe(backupCard.id);
      expect(stored?.purchaseBatches).toHaveLength(2);
    },
  );

  integrationTest(
    'transfers a backup to another account without changing the owner',
    async ({ app, db, user: owner, createUser, authenticatedHeaders }) => {
      const recipient = await createUser({});
      expect((await createCardRequest(app, owner.sessionToken, validCardPayload)).status).toBe(
        CONTENTFUL_STATUS_CODES.CREATED,
      );

      const original = ExportCardsResponseSchema.parse(
        await (
          await app.request(EXPORT_CARDS_ROUTE_PATH, {
            headers: authenticatedHeaders,
          })
        ).json(),
      );

      const result = await app.request(IMPORT_CARDS_ROUTE_PATH, {
        method: 'POST',
        headers: sessionHeaders(recipient.sessionToken),
        body: JSON.stringify(
          await csvImportPayload(
            db,
            original.entries.map(source => ({ ...source, name: 'Recipient copy' })),
            'scrydex_static',
          ),
        ),
      });

      expect(result.status).toBe(CONTENTFUL_STATUS_CODES.OK);
      expect(await result.json()).toEqual({ imported_count: 1, updated_count: 0, skipped_count: 0 });
      expect(await db.select().from(card).where(eq(card.userId, owner.userId))).toHaveLength(1);
      expect(await db.select().from(card).where(eq(card.userId, recipient.userId))).toHaveLength(1);
      expect(
        ExportCardsResponseSchema.parse(
          await (
            await app.request(EXPORT_CARDS_ROUTE_PATH, {
              headers: authenticatedHeaders,
            })
          ).json(),
        ),
      ).toEqual(original);
    },
  );

  integrationTest(
    'handles concurrent imports without duplicate purchases',
    async ({ app, db, user, authenticatedHeaders }) => {
      const requests = await Promise.all(
        [1, 2].map(async () => {
          return app.request(IMPORT_CARDS_ROUTE_PATH, {
            method: 'POST',
            headers: authenticatedHeaders,
            body: JSON.stringify(await csvImportPayload(db, [backupCard], 'scrydex_static')),
          });
        }),
      );

      expect(requests.map(response => response.status)).toEqual([
        CONTENTFUL_STATUS_CODES.OK,
        CONTENTFUL_STATUS_CODES.OK,
      ]);

      const results = await Promise.all(
        requests.map(async response => ImportCardsResponseSchema.parse(await response.json())),
      );

      expect(results.reduce((sum, result) => sum + result.imported_count, 0)).toBe(1);
      expect(await db.query.card.findMany({ where: { userId: user.userId }, with: { purchaseBatches: true } })).toEqual(
        [
          expect.objectContaining({
            purchaseBatches: expect.arrayContaining([
              expect.objectContaining({ quantity: 2 }),
              expect.objectContaining({ quantity: 1 }),
            ]),
          }),
        ],
      );
    },
  );

  integrationTest(
    'rejects invalid paired costs before persisting any cards',
    async ({ app, db, user, authenticatedHeaders }) => {
      const invalid = {
        ...backupCard,
        id: '550e8400-e29b-41d4-a716-446655440003',
        purchases: [{ ...backupCard.purchases[0], currency: null }],
      };

      const response = await app.request(IMPORT_CARDS_ROUTE_PATH, {
        method: 'POST',
        headers: authenticatedHeaders,
        body: JSON.stringify(await csvImportPayload(db, [backupCard, invalid], 'scrydex_static')),
      });

      expect(response.status).toBe(CONTENTFUL_STATUS_CODES.BAD_REQUEST);
      expect(await db.select().from(card).where(eq(card.userId, user.userId))).toEqual([]);
    },
  );

  integrationTest(
    'returns repository failures as 500 and rolls back the import',
    async ({ app, db, getLogsForRequestId, withRequestId, user, authenticatedHeaders }) => {
      const { headers, requestId } = withRequestId(authenticatedHeaders, createTestRequestId());
      await db.execute(sql`alter table ${cardPurchaseBatch} add constraint forced_import_failure check (quantity < 0)`);

      const response = await app.request(IMPORT_CARDS_ROUTE_PATH, {
        method: 'POST',
        headers,
        body: JSON.stringify(await csvImportPayload(db, [backupCard], 'scrydex_static')),
      });

      expect(response.status).toBe(CONTENTFUL_STATUS_CODES.INTERNAL_SERVER_ERROR);
      expect(await response.json()).toEqual({ message: 'Something went wrong', code: 'INTERNAL_SERVER_ERROR' });
      expect(await db.$count(card, eq(card.userId, user.userId))).toBe(0);
      expect(await db.$count(cardPurchaseBatch)).toBe(0);
      const logs = getLogsForRequestId(requestId);
      expect(logs.map(log => log.event)).toEqual([
        'auth.session.lookup',
        'cards.import.validated',
        'cards.import.lock_acquired',
        'cards.import.ownership_resolved',
        'request.failed',
      ]);
      expect(logs.at(-1)).toMatchObject({
        outcome: 'failure',
        import_stage: 'batch_preparation',
        import_last_completed_stage: 'ownership_resolved',
        transaction_status: 'rolled_back',
      });
      expect(logs).not.toEqual(expect.arrayContaining([expect.objectContaining({ event: 'cards.import' })]));
    },
  );

  integrationTest(
    'backs up cards without fetching prices or filling missing costs',
    async ({ createApp, db, authenticatedHeaders }) => {
      let providerRequests = 0;

      const pricingClient = createTestScrydexClient(async () => {
        providerRequests += 1;

        return new Response('Unavailable', { status: 503 });
      }, {});

      const isolated = createApp({ pricingClient });

      const imported = await isolated.request(IMPORT_CARDS_ROUTE_PATH, {
        method: 'POST',
        headers: authenticatedHeaders,
        body: JSON.stringify(await csvImportPayload(db, [backupCard], 'scrydex_real')),
      });

      expect(imported.status).toBe(CONTENTFUL_STATUS_CODES.OK);
      const exported = await isolated.request(EXPORT_CARDS_ROUTE_PATH, { headers: authenticatedHeaders });
      expect(exported.status).toBe(CONTENTFUL_STATUS_CODES.OK);
      const body = ExportCardsResponseSchema.parse(await exported.json());
      expect(body.entries[0]?.purchases).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            condition: 'played',
            purchase_price: null,
            currency: null,
            automatic_price_date: null,
          }),
        ]),
      );
      expect(providerRequests).toBe(0);
    },
  );

  integrationTest(
    'accepts the generated client wire shape for the supplied Japanese CSV and logs committed milestones',
    async ({ app, db, getLogsForRequestId, withRequestId, user, authenticatedHeaders }) => {
      const { headers, requestId } = withRequestId(authenticatedHeaders, createTestRequestId());

      const input = {
        id: '9ecb8b92-e1ad-4863-bd0e-7ca38210835b',
        game: 'pokemon',
        name: 'イブキのカイリュー',
        set_name: 'ポケモンカード★VS',
        card_number: '049/141',
        created_at: '2026-10-13T19:32:58.959Z',
        updated_at: '2026-10-13T19:32:59.788Z',
        purchases: [
          {
            id: 'fd9bb814-18c4-464b-a7b2-bb303c19933d',
            condition: 'excellent',
            quantity: 1,
            purchase_price: '180',
            currency: 'USD',
          },
        ],
      };

      const response = await app.request(IMPORT_CARDS_ROUTE_PATH, {
        method: 'POST',
        headers,
        body: JSON.stringify(await csvImportPayload(db, [input], 'scrydex_static')),
      });

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ imported_count: 1, updated_count: 0, skipped_count: 0 });
      const logs = getLogsForRequestId(requestId);
      expect(logs.map(log => log.event)).toEqual([
        'auth.session.lookup',
        'cards.import.validated',
        'cards.import.lock_acquired',
        'cards.import.ownership_resolved',
        'cards.import.batch_prepared',
        'cards.import',
        'request.completed',
      ]);
      expect(logs).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            event: 'cards.import.batch_prepared',
            transaction_status: 'pending',
            result_count: 1,
            updated_count: 0,
            purchase_count: 1,
          }),
          expect.objectContaining({
            event: 'cards.import',
            outcome: 'success',
            transaction_status: 'committed',
            result_count: 1,
          }),
        ]),
      );
      expect(logs.every(log => log.request_id === requestId && log.user_id === user.userId)).toBe(true);
      const before = await db.query.card.findFirst({ where: { userId: user.userId }, with: { purchaseBatches: true } });

      const repeated = await app.request(IMPORT_CARDS_ROUTE_PATH, {
        method: 'POST',
        headers: authenticatedHeaders,
        body: JSON.stringify(await csvImportPayload(db, [input], 'scrydex_static')),
      });

      expect(await repeated.json()).toEqual({ imported_count: 0, updated_count: 0, skipped_count: 1 });
      expect(
        await db.query.card.findFirst({ where: { userId: user.userId }, with: { purchaseBatches: true } }),
      ).toEqual(before);
    },
  );

  integrationTest(
    'updates ownership while retaining card identity, creation time and owned purchase IDs',
    async ({ app, db, user, authenticatedHeaders }) => {
      expect((await createCardRequest(app, user.sessionToken, validCardPayload)).status).toBe(201);

      const original = ExportCardsResponseSchema.parse(
        await (await app.request(EXPORT_CARDS_ROUTE_PATH, { headers: authenticatedHeaders })).json(),
      );

      const source = original.entries[0];
      assert(source);
      expect(source).toBeDefined();

      const unchanged = await app.request(IMPORT_CARDS_ROUTE_PATH, {
        method: 'POST',
        headers: authenticatedHeaders,
        body: JSON.stringify(await csvImportPayload(db, original.entries, 'scrydex_static')),
      });

      expect(await unchanged.json()).toEqual({ imported_count: 0, updated_count: 0, skipped_count: 1 });
      const purchase = source.purchases[0];
      assert(purchase);

      const input = {
        ...source,
        notes: 'Restored',
        created_at: backupCard.created_at,
        updated_at: backupCard.updated_at,
        purchases: [
          { ...purchase, quantity: 3, purchase_price: '180', currency: 'USD', automatic_price_date: '2026-07-20' },
        ],
      };

      const updated = await app.request(IMPORT_CARDS_ROUTE_PATH, {
        method: 'POST',
        headers: authenticatedHeaders,
        body: JSON.stringify(await csvImportPayload(db, [input], 'scrydex_static')),
      });

      expect(updated.status).toBe(200);
      expect(await updated.json()).toEqual({ imported_count: 0, updated_count: 1, skipped_count: 0 });

      const stored = await db.query.card.findFirst({
        where: { userId: user.userId },
        with: { purchaseBatches: true, quantities: true },
      });

      expect(stored).toMatchObject({
        id: source.id,
        name: source.name,
        notes: 'Restored',
        pricingSource: 'scrydex_static',
        createdAt: new Date(source.created_at),
        updatedAt: new Date(backupCard.updated_at),
      });
      assert(stored);
      expect(stored.purchaseBatches).toEqual([
        expect.objectContaining({
          id: purchase.id,
          quantity: 3,
          purchasePrice: '180.000000',
          currency: 'USD',
          automaticPriceDate: '2026-07-20',
        }),
      ]);
      expect(stored.quantities).toEqual([expect.objectContaining({ condition: purchase.condition, quantity: 3 })]);

      const repeated = await app.request(IMPORT_CARDS_ROUTE_PATH, {
        method: 'POST',
        headers: authenticatedHeaders,
        body: JSON.stringify(await csvImportPayload(db, [input], 'scrydex_static')),
      });

      expect(await repeated.json()).toEqual({ imported_count: 0, updated_count: 0, skipped_count: 1 });
      expect(
        await db.query.card.findFirst({
          where: { userId: user.userId },
          with: { purchaseBatches: true, quantities: true },
        }),
      ).toEqual(stored);
    },
  );

  integrationTest(
    'updates imported source IDs, removes absent purchases, and ignores purchase order on retry',
    async ({ app, db, user, authenticatedHeaders }) => {
      const request = async (cards: (Omit<typeof backupCard, 'purchases'> & { purchases: unknown })[]) => {
        return app.request(IMPORT_CARDS_ROUTE_PATH, {
          method: 'POST',
          headers: authenticatedHeaders,
          body: JSON.stringify(await csvImportPayload(db, cards, 'scrydex_static')),
        });
      };

      expect((await request([backupCard])).status).toBe(200);
      const reordered = { ...backupCard, purchases: backupCard.purchases.toReversed() };
      expect(await (await request([reordered])).json()).toEqual({
        imported_count: 0,
        updated_count: 0,
        skipped_count: 1,
      });

      const changed = {
        ...backupCard,
        purchases: [{ ...backupCard.purchases[0], quantity: 4, purchase_price: '180' }],
      };

      expect(await (await request([changed])).json()).toEqual({
        imported_count: 0,
        updated_count: 1,
        skipped_count: 0,
      });

      const stored = await db.query.card.findFirst({
        where: { userId: user.userId },
        with: { purchaseBatches: true, quantities: true },
      });

      assert(stored);
      expect(stored.purchaseBatches).toEqual([expect.objectContaining({ quantity: 4, purchasePrice: '180.000000' })]);
      expect(stored.quantities).toEqual([expect.objectContaining({ condition: 'near_mint', quantity: 4 })]);
      expect(await (await request([changed])).json()).toEqual({
        imported_count: 0,
        updated_count: 0,
        skipped_count: 1,
      });
    },
  );

  integrationTest(
    'returns and logs the specific indexed date validation failure',
    async ({ app, db, getLogsForRequestId, withRequestId, user, authenticatedHeaders }) => {
      const { headers, requestId } = withRequestId(authenticatedHeaders, createTestRequestId());
      const input = { ...backupCard, purchases: [{ ...backupCard.purchases[0], automatic_price_date: '' }] };

      const response = await app.request(IMPORT_CARDS_ROUTE_PATH, {
        method: 'POST',
        headers,
        body: JSON.stringify(await csvImportPayload(db, [input], 'scrydex_static')),
      });

      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({
        context: {
          validations: [
            {
              code: 'invalid_format',
              path: ['cards', '0', 'purchases', '0', 'automatic_price_date'],
              message: 'Invalid ISO date',
            },
          ],
        },
      });
      expect(getLogsForRequestId(requestId)).toEqual([
        expect.objectContaining({ event: 'auth.session.lookup', outcome: 'success' }),
        expect.objectContaining({
          event: 'request.validation.failed',
          validation_issue_count: 1,
          validation_issue_paths: ['cards.0.purchases.0.automatic_price_date'],
          validation_issue_codes: ['invalid_format'],
          validation_issue_messages: ['Invalid ISO date'],
        }),
      ]);
      expect(await db.$count(card, eq(card.userId, user.userId))).toBe(0);
    },
  );

  integrationTest(
    'accepts omitted costs and dates as null purchases',
    async ({ app, db, user, authenticatedHeaders }) => {
      const input = {
        ...backupCard,
        purchases: [{ id: backupCard.purchases[0]?.id, condition: 'excellent', quantity: 1 }],
      };

      const response = await app.request(IMPORT_CARDS_ROUTE_PATH, {
        method: 'POST',
        headers: authenticatedHeaders,
        body: JSON.stringify(await csvImportPayload(db, [input], 'scrydex_static')),
      });

      expect(response.status).toBe(200);
      const stored = await db.query.card.findFirst({ where: { userId: user.userId }, with: { purchaseBatches: true } });
      assert(stored);
      expect(stored.purchaseBatches).toEqual([
        expect.objectContaining({ purchasePrice: null, currency: null, automaticPriceDate: null }),
      ]);
    },
  );

  integrationTest(
    'rolls back replacement fields, deleted purchases, and quantities when purchase persistence fails',
    async ({ app, db, user, authenticatedHeaders }) => {
      const request = async (cards: (Omit<typeof backupCard, 'purchases'> & { purchases: unknown })[]) => {
        return app.request(IMPORT_CARDS_ROUTE_PATH, {
          method: 'POST',
          headers: authenticatedHeaders,
          body: JSON.stringify(await csvImportPayload(db, cards, 'scrydex_static')),
        });
      };

      expect((await request([backupCard])).status).toBe(200);

      const before = await db.query.card.findFirst({
        where: { userId: user.userId },
        with: { purchaseBatches: true, quantities: true },
      });

      await db.execute(
        sql`alter table ${cardPurchaseBatch} add constraint forced_import_failure check (quantity < 0) not valid`,
      );

      const response = await request([
        { ...backupCard, notes: 'Failed replacement', purchases: [{ ...backupCard.purchases[0], quantity: 3 }] },
      ]);

      expect(response.status).toBe(500);
      expect(
        await db.query.card.findFirst({
          where: { userId: user.userId },
          with: { purchaseBatches: true, quantities: true },
        }),
      ).toEqual(before);
    },
  );

  integrationTest(
    'rejects missing or unknown printings and rolls back a mismatched existing printing',
    async ({ app, db, user, authenticatedHeaders }) => {
      const owned = await createCardRequest(app, user.sessionToken, validCardPayload);
      const original = await owned.json();
      const [valid] = (await csvImportPayload(db, [backupCard], 'scrydex_static')).cards;
      assert(valid != null);

      const send = (cards: unknown[]) => {
        return app.request(IMPORT_CARDS_ROUTE_PATH, {
          method: 'POST',
          headers: authenticatedHeaders,
          body: JSON.stringify({ cards }),
        });
      };

      const invalidCard = { ...valid, id: crypto.randomUUID() };
      const path = ['cards', '1', 'priced_card_id'];
      const missing = await send([valid, { ...invalidCard, priced_card_id: undefined }]);

      expect(missing.status).toBe(400);
      expect(await missing.json()).toMatchObject({
        code: 'INVALID_PAYLOAD',
        context: { validations: [{ path }] },
      });

      const unknown = await send([valid, { ...invalidCard, priced_card_id: 'b0fc023e-863e-4ddc-a879-bf4c5a59f60b' }]);

      expect(unknown.status).toBe(400);
      expect(await unknown.json()).toMatchObject({
        code: 'INVALID_PAYLOAD',
        context: {
          validations: [
            {
              code: 'invalid_printing',
              path,
              message:
                'The printing ID could not be found in the catalog. Retry the catalog lookup and select a printing.',
            },
          ],
        },
      });

      const alternate = await seedCatalogPrinting(db, backupCard, 'scrydex_static', 'altArt');

      const conflict = await send([
        valid,
        { ...valid, id: original.id, priced_card_id: alternate.id, notes: 'Rejected' },
      ]);

      expect(conflict.status).toBe(400);
      expect(await conflict.json()).toMatchObject({
        code: 'INVALID_PAYLOAD',
        context: {
          validations: [
            {
              code: 'printing_conflict',
              path,
              message:
                'The selected printing conflicts with the saved card for this ID. Select the printing already in your collection.',
            },
          ],
        },
      });
      expect(await db.$count(card)).toBe(1);
      expect(await db.query.card.findFirst({ where: { userId: user.userId } })).toMatchObject({ notes: null });
    },
  );

  integrationTest('supports an empty collection and an empty import', async ({ app, authenticatedHeaders }) => {
    expect(await (await app.request(EXPORT_CARDS_ROUTE_PATH, { headers: authenticatedHeaders })).json()).toEqual({
      entries: [],
      next_cursor: null,
    });
    expect(
      await (
        await app.request(IMPORT_CARDS_ROUTE_PATH, {
          method: 'POST',
          headers: authenticatedHeaders,
          body: JSON.stringify({ cards: [] }),
        })
      ).json(),
    ).toEqual({ imported_count: 0, updated_count: 0, skipped_count: 0 });
  });
});
