import { createCardRequest, sessionHeaders, validCardPayload } from './utils.ts';
import { integrationTest } from '../../tests/fixtures.ts';
import { createTestUser } from '../../tests/utils.ts';
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
