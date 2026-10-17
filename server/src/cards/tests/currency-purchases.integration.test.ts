import { createCardRequest, sessionHeaders, validCardPayload } from './utils.ts';
import { card } from '../../db/schema/cards.ts';
import { exchangeRate } from '../../db/schema/forex.ts';
import { integrationTest } from '../../tests/fixtures.ts';
import { createTestUser } from '../../tests/utils.ts';
import { LIST_CARDS_ROUTE_PATH } from '../routes/list-cards.ts';
import { CardSchema } from '../schemas/responses.ts';

integrationTest('stores EUR and JPY purchases unchanged when the display preference changes', async ({ app, db }) => {
  const user = await createTestUser(app, db);

  const created = await createCardRequest(app, user.sessionToken, {
    ...validCardPayload,
    purchases: [
      { condition: 'near_mint', quantity: 2, purchase_price: '10.25', currency: 'EUR' },
      { condition: 'near_mint', quantity: 1, purchase_price: '1500', currency: 'JPY' },
    ],
  });

  expect(created.status).toBe(201);
  const card = CardSchema.parse(await created.json());
  expect(card.purchases).toHaveLength(2);
  expect(card.purchases).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ purchase_price: '10.250000', currency: 'EUR', quantity: 2 }),
      expect.objectContaining({ purchase_price: '1500.000000', currency: 'JPY', quantity: 1 }),
    ]),
  );

  const changed = await app.request('/app-api/auth/preferences', {
    method: 'PATCH',
    headers: sessionHeaders(user.sessionToken),
    body: JSON.stringify({ preferred_currency: 'GBP' }),
  });

  expect(changed.status).toBe(200);
  const stored = await db.query.cardPurchaseBatch.findMany({ where: { cardId: card.id } });
  expect(stored).toHaveLength(2);
  expect(stored).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ purchasePrice: '10.250000', currency: 'EUR', quantity: 2 }),
      expect.objectContaining({ purchasePrice: '1500.000000', currency: 'JPY', quantity: 1 }),
    ]),
  );
});

for (const method of ['GET', 'POST', 'PUT'] as const) {
  integrationTest(
    `stops ${method} card requests before pricing when stored rates are invalid`,
    async ({ app, db, pricingClient }) => {
      const user = await createTestUser(app, db);

      const [existing] = await db
        .insert(card)
        .values({
          userId: user.userId,
          game: validCardPayload.game,
          name: validCardPayload.name,
          setName: validCardPayload.set_name,
          cardNumber: validCardPayload.card_number,
        })
        .returning({ id: card.id });

      assert(existing != null);
      await db.insert(exchangeRate).values({ date: '2026-10-16', rates: {} });
      const search = vi.spyOn(pricingClient, 'searchCards');
      const getCard = vi.spyOn(pricingClient, 'getCardById');
      const path = method === 'PUT' ? `${LIST_CARDS_ROUTE_PATH}/${existing.id}` : LIST_CARDS_ROUTE_PATH;

      const response = await app.request(path, {
        method,
        headers: sessionHeaders(user.sessionToken),
        body: method === 'GET' ? null : JSON.stringify(validCardPayload),
      });

      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({ code: 'INTERNAL_SERVER_ERROR', message: 'Something went wrong' });
      expect(search).not.toHaveBeenCalled();
      expect(getCard).not.toHaveBeenCalled();
      expect(await db.query.cardPrice.findMany()).toEqual([]);
    },
  );
}
