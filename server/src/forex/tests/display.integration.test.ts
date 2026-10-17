import { SEARCH_PRICING_ROUTE_PATH } from '../../card-pricing/routes/search-pricing.ts';
import { PricingSearchResponseSchema } from '../../card-pricing/schemas/responses.ts';
import { LIST_CARDS_ROUTE_PATH } from '../../cards/routes/list-cards.ts';
import { CardWithPriceSchema } from '../../cards/schemas/responses.ts';
import { createCardRequest, sessionHeaders, validCardPayload } from '../../cards/tests/utils.ts';
import { exchangeRate } from '../../db/schema/forex.ts';
import { integrationTest } from '../../tests/fixtures.ts';
import { createTestUser } from '../../tests/utils.ts';

integrationTest(
  'shared market caches return separate account display currencies and reflect saved preference changes',
  async ({ app, db, pricingClient, getLogsForRequestId }) => {
    const first = await createTestUser(app, db);
    const second = await createTestUser(app, db);
    await db.insert(exchangeRate).values({ date: '2026-10-16', rates: { EUR: 1, USD: 1.25, JPY: 150 } });
    await app.request('/app-api/auth/preferences', {
      method: 'PATCH',
      headers: sessionHeaders(first.sessionToken),
      body: JSON.stringify({ preferred_currency: 'EUR' }),
    });
    await app.request('/app-api/auth/preferences', {
      method: 'PATCH',
      headers: sessionHeaders(second.sessionToken),
      body: JSON.stringify({ preferred_currency: 'JPY' }),
    });
    const provider = vi.spyOn(pricingClient, 'searchCards');
    const path = `${SEARCH_PRICING_ROUTE_PATH}?game=pokemon&query=Giratina`;
    const eurResponse = await app.request(path, { headers: sessionHeaders(first.sessionToken) });
    const eur = PricingSearchResponseSchema.parse(await eurResponse.json()).matches[0];
    assert(eur?.headline != null);
    expect(eur.display?.headline?.currency).toBe('EUR');
    expect(eur.display?.headline?.amount).toBeCloseTo(eur.headline.amount / 1.25, 6);
    const jpyResponse = await app.request(path, { headers: sessionHeaders(second.sessionToken) });
    const jpy = PricingSearchResponseSchema.parse(await jpyResponse.json()).matches[0];
    assert(jpy?.headline != null);
    expect(jpy.display?.headline?.currency).toBe('JPY');
    expect(jpy.display?.headline?.amount).toBeCloseTo(jpy.headline.amount * 120, 6);
    expect(jpy.headline).toEqual(eur.headline);
    expect(provider).toHaveBeenCalledTimes(1);
    await app.request('/app-api/auth/preferences', {
      method: 'PATCH',
      headers: sessionHeaders(first.sessionToken),
      body: JSON.stringify({ preferred_currency: 'JPY' }),
    });
    const changedResponse = await app.request(path, { headers: sessionHeaders(first.sessionToken) });
    const changed = PricingSearchResponseSchema.parse(await changedResponse.json()).matches[0];
    expect(changed?.display).toEqual(jpy.display);
    expect(provider).toHaveBeenCalledTimes(1);
    expect(getLogsForRequestId(String(changedResponse.headers.get('tcg-request-id')))).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ event: 'forex.display.completed', target_currency: 'JPY', fallback_count: 0 }),
      ]),
    );
  },
);

integrationTest('purchase display conversion preserves travel costs for editing and export', async ({ app, db }) => {
  const user = await createTestUser(app, db);
  const headers = sessionHeaders(user.sessionToken);
  await app.request('/app-api/auth/preferences', {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ preferred_currency: 'EUR' }),
  });
  await db.insert(exchangeRate).values({ date: '2026-10-16', rates: { EUR: 1, USD: 1.25, JPY: 150 } });

  const response = await createCardRequest(app, user.sessionToken, {
    ...validCardPayload,
    purchases: [{ condition: 'near_mint', quantity: 2, purchase_price: '1500', currency: 'JPY' }],
  });

  expect(response.status).toBe(201);
  const created = CardWithPriceSchema.parse(await response.json());
  expect(created.purchases[0]).toMatchObject({
    purchase_price: '1500.000000',
    currency: 'JPY',
    display_price: { amount: '10.000000', currency: 'EUR', conversion_unavailable: false },
  });
  const saved = await db.query.cardPurchaseBatch.findFirst({ where: { cardId: created.id } });
  expect(saved).toMatchObject({ purchasePrice: '1500.000000', currency: 'JPY' });
  const exported = await app.request(`${LIST_CARDS_ROUTE_PATH}/export`, { headers });
  expect(await exported.json()).toMatchObject({
    cards: [
      expect.objectContaining({
        purchases: [expect.objectContaining({ purchase_price: '1500.000000', currency: 'JPY' })],
      }),
    ],
  });
});

integrationTest(
  'missing rates retain source prices and log display fallbacks',
  async ({ app, db, getLogsForRequestId }) => {
    const user = await createTestUser(app, db);
    const headers = sessionHeaders(user.sessionToken);
    await app.request('/app-api/auth/preferences', {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ preferred_currency: 'EUR' }),
    });
    const response = await app.request(`${SEARCH_PRICING_ROUTE_PATH}?game=pokemon&query=Giratina`, { headers });
    expect(response.status).toBe(200);
    const card = PricingSearchResponseSchema.parse(await response.json()).matches[0];
    assert(card?.headline != null);
    expect(card.display).toMatchObject({
      preferred_currency: 'EUR',
      conversion_unavailable: true,
      headline: card.headline,
    });
    expect(getLogsForRequestId(String(response.headers.get('tcg-request-id')))).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: 'forex.display.completed',
          target_currency: 'EUR',
          fallback_count: 1,
          level: 40,
        }),
      ]),
    );
  },
);
