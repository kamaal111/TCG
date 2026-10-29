import assert from 'node:assert/strict';

import { eq } from 'drizzle-orm';

import { createCardRequest, validCardPayload, createTestCard } from './utils.ts';
import { cardConditionQuantity, cardPurchaseBatch } from '../../db/schema/cards.ts';
import { integrationTest } from '../../tests/fixtures.ts';
import { CardWithPriceSchema, CardsListResponseSchema } from '../schemas/responses.ts';

const payload = {
  ...validCardPayload,
  purchases: [
    { condition: 'near_mint' as const, quantity: 2, purchase_price: '2', currency: 'USD' as const },
    { condition: 'near_mint' as const, quantity: 3, purchase_price: '4', currency: 'USD' as const },
  ],
};

describe('Purchase batches integration', () => {
  integrationTest(
    'creates purchases and replaces them by editing, adding, and omitting IDs',
    async ({ app, db, user, authenticatedHeaders }) => {
      const response = await createCardRequest(app, user.sessionToken, payload);
      expect(response.status).toBe(201);
      const body = await response.json();
      expect(body).not.toHaveProperty('quantities');
      expect(body).not.toHaveProperty('purchase_batches');
      const original = CardWithPriceSchema.parse(body);
      expect(original.purchases.map(batch => batch.purchase_price)).toEqual(
        expect.arrayContaining(['2.000000', '4.000000']),
      );
      expect(
        await db.select().from(cardConditionQuantity).where(eq(cardConditionQuantity.cardId, original.id)),
      ).toMatchObject([{ condition: 'near_mint', quantity: 5 }]);
      const market = original.price.priced_card?.market?.market;
      assert(market != null);
      expect(original.purchase_price_change_percent).toBeCloseTo(((market * 5 - 16) / 16) * 100, 5);
      const batch = original.purchases.find(purchase => purchase.purchase_price === '2.000000');
      assert(batch != null);

      const update = await app.request(`/app-api/cards/${original.id}`, {
        method: 'PUT',
        headers: authenticatedHeaders,
        body: JSON.stringify({
          ...payload,
          purchases: [
            { ...batch, purchase_price: '3.123456' },
            { condition: 'played', quantity: 1, purchase_price: '1', currency: 'USD' },
          ],
        }),
      });

      expect(update.status).toBe(200);
      const edited = CardWithPriceSchema.parse(await update.json());
      expect(edited.purchases).toHaveLength(2);
      expect(edited.purchases).toEqual(
        expect.arrayContaining([
          {
            ...batch,
            purchase_price: '3.123456',
            automatic_price_date: null,
            display_price: { amount: '3.123456', currency: 'USD', conversion_unavailable: false },
          },
          expect.objectContaining({ condition: 'played', quantity: 1, purchase_price: '1.000000', currency: 'USD' }),
        ]),
      );
      const added = edited.purchases.find(purchase => purchase.condition === 'played');
      assert(added != null);
      expect(original.purchases.map(purchase => purchase.id)).not.toContain(added.id);
      expect(await db.select().from(cardPurchaseBatch).where(eq(cardPurchaseBatch.cardId, original.id))).toHaveLength(
        2,
      );
      expect(
        await db.select().from(cardConditionQuantity).where(eq(cardConditionQuantity.cardId, original.id)),
      ).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ condition: 'near_mint', quantity: 2 }),
          expect.objectContaining({ condition: 'played', quantity: 1 }),
        ]),
      );
    },
  );

  integrationTest(
    'backfills only missing costs and does not rewrite them on cached refreshes',
    async ({ app, db, user, authenticatedHeaders }) => {
      const created = await createTestCard(app, user.sessionToken, payload);
      const batch = created.purchases.find(purchase => purchase.purchase_price === '4.000000');
      assert(batch != null);
      await db
        .update(cardPurchaseBatch)
        .set({ purchasePrice: null, currency: null })
        .where(eq(cardPurchaseBatch.id, batch.id));
      const firstResponse = await app.request('/app-api/cards', { headers: authenticatedHeaders });
      expect(firstResponse.status).toBe(200);
      const first = CardsListResponseSchema.parse(await firstResponse.json()).cards[0];
      assert(first != null);
      const market = first.price.priced_card?.market;
      assert(market?.market != null);
      expect(first.purchases).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ purchase_price: '2.000000', automatic_price_date: null }),
          expect.objectContaining({
            purchase_price: market.market.toFixed(6),
            currency: market.currency,
            automatic_price_date: first.price.priced_card?.priced_on.slice(0, 10),
          }),
        ]),
      );
      const persisted = await db.select().from(cardPurchaseBatch).where(eq(cardPurchaseBatch.cardId, created.id));
      const secondResponse = await app.request('/app-api/cards', { headers: authenticatedHeaders });
      expect(secondResponse.status).toBe(200);
      expect(CardsListResponseSchema.parse(await secondResponse.json()).cards[0]).toEqual(first);
      expect(await db.select().from(cardPurchaseBatch).where(eq(cardPurchaseBatch.cardId, created.id))).toEqual(
        persisted,
      );
    },
  );

  integrationTest(
    'rejects foreign batch IDs and rolls back metadata changes',
    async ({ app, db, user: owner, createUser, authenticatedHeaders }) => {
      const other = await createUser();
      const owned = await createTestCard(app, owner.sessionToken, payload);
      const foreign = await createTestCard(app, other.sessionToken, payload);
      const batch = foreign.purchases[0];
      assert(batch != null);

      const response = await app.request(`/app-api/cards/${owned.id}`, {
        method: 'PUT',
        headers: authenticatedHeaders,
        body: JSON.stringify({
          ...payload,
          name: 'Changed',
          purchases: [{ ...payload.purchases[0], id: batch.id }, payload.purchases[1]],
        }),
      });

      expect(response.status).toBe(404);
      expect(await response.json()).toMatchObject({ code: 'CARD_NOT_FOUND' });
      expect(await db.query.card.findFirst({ where: { id: owned.id } })).toMatchObject({ name: owned.name });
      expect(await db.select().from(cardPurchaseBatch).where(eq(cardPurchaseBatch.cardId, owned.id))).toHaveLength(2);
    },
  );

  integrationTest('rejects requests without purchases', async ({ app, db, user, authenticatedHeaders }) => {
    const original = await createTestCard(app, user.sessionToken, payload);

    const response = await app.request(`/app-api/cards/${original.id}`, {
      method: 'PUT',
      headers: authenticatedHeaders,
      body: JSON.stringify({
        ...validCardPayload,
        purchases: undefined,
        quantities: [{ condition: 'near_mint', quantity: 2 }],
      }),
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      code: 'INVALID_PAYLOAD',
      context: { validations: [{ path: ['purchases'] }] },
    });
    expect(await db.select().from(cardPurchaseBatch).where(eq(cardPurchaseBatch.cardId, original.id))).toHaveLength(2);
  });

  integrationTest('rejects a negative purchase amount without inserting a card', async ({ app, db, user }) => {
    const response = await createCardRequest(app, user.sessionToken, {
      ...payload,
      purchases: payload.purchases.map(batch => ({ ...batch, purchase_price: '-1' })),
    });

    expect(response.status).toBe(400);
    expect(await db.query.card.findMany()).toHaveLength(0);
  });

  integrationTest('rejects condition totals above the limit', async ({ app, db, user }) => {
    const response = await createCardRequest(app, user.sessionToken, {
      ...payload,
      purchases: payload.purchases.map(batch => ({ ...batch, quantity: 999 })),
    });

    expect(response.status).toBe(400);
    expect(await db.query.card.findMany()).toHaveLength(0);
  });
});
