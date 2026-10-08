import assert from 'node:assert/strict';

import { eq } from 'drizzle-orm';

import App from '../../app.ts';
import { LIST_CARDS_ROUTE_PATH } from '../../cards/routes/list-cards.ts';
import { CardsListResponseSchema, CardSchema } from '../../cards/schemas/responses.ts';
import { createCardRequest, sessionHeaders } from '../../cards/tests/utils.ts';
import { card } from '../../db/schema/cards.ts';
import { integrationTest } from '../../tests/fixtures.ts';
import { createTestUser } from '../../tests/utils.ts';
import { RealScrydexClient } from '../scrydex/real-client.ts';
import { StaticScrydexClient } from '../scrydex/static-client.ts';

const providerCard = {
  id: 'm6_ja-88',
  name: 'ピカチュウ',
  number: '88',
  printed_number: '088/080',
  variants: [{ name: 'holofoil', prices: [{ condition: 'NM', type: 'raw', currency: 'JPY', low: 800 }] }],
};

describe('Scrydex owned-card pricing', () => {
  integrationTest('decodes a daily lookup and reuses the persisted price', async ({ app, db, storageClient }) => {
    const user = await createTestUser(app, db);
    const created = CardSchema.parse(await (await createCardRequest(app, user.sessionToken)).json());
    await db
      .update(card)
      .set({ game: 'pokemon', pricingCardId: providerCard.id, pricingSource: 'scrydex_real' })
      .where(eq(card.id, created.id));

    let calls = 0;

    const pricingClient = new RealScrydexClient({
      apiKey: 'test-key',
      teamId: 'test-team',
      fetch: async input => {
        calls += 1;
        const url = new URL(input instanceof Request ? input.url : input.toString());

        expect(url.pathname).toBe('/pokemon/v1/cards/m6_ja-88');
        expect(url.searchParams.get('include')).toBe('prices');

        return Response.json({ status: 'success', data: providerCard });
      },
    });

    const realApp = new App({ db, storageClient, pricingClient }).app;
    const first = await realApp.request(LIST_CARDS_ROUTE_PATH, { headers: sessionHeaders(user.sessionToken) });
    expect(first.status).toBe(200);
    const body = CardsListResponseSchema.parse(await first.json());
    expect(body.cards[0]?.price).toMatchObject({
      status: 'priced',
      priced_card: { headline: { amount: 800, currency: 'JPY' } },
    });
    expect(await db.query.cardPrice.findFirst({ where: { pricingSource: 'scrydex_real' } })).toMatchObject({
      raw: providerCard,
    });
    const second = await realApp.request(LIST_CARDS_ROUTE_PATH, { headers: sessionHeaders(user.sessionToken) });
    expect(second.status).toBe(200);
    expect(CardsListResponseSchema.parse(await second.json())).toEqual(body);
    expect(calls).toBe(1);
  });

  integrationTest(
    'does not hide unexpected collection pricing failures',
    async ({ app, db, storageClient, withRequestId, getLogsForRequestId }) => {
      const user = await createTestUser(app, db);
      const created = CardSchema.parse(await (await createCardRequest(app, user.sessionToken)).json());
      await db
        .update(card)
        .set({ pricingCardId: 'uncached', pricingSource: 'scrydex_static' })
        .where(eq(card.id, created.id));

      const realApp = new App({ db, storageClient, pricingClient: new UnexpectedPricingClient() }).app;
      const { headers, requestId } = withRequestId(Object.fromEntries(sessionHeaders(user.sessionToken).entries()));
      const response = await realApp.request(LIST_CARDS_ROUTE_PATH, { headers });
      expect(response.status).toBe(500);
      expect(getLogsForRequestId(requestId)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            event: 'pricing.lock.completed',
            lock_status: 'acquired',
            error_code: 'PRICING_OPERATION_FAILED',
          }),
        ]),
      );
    },
  );

  integrationTest(
    'keeps create and update pricing failures strict after saving',
    async ({ app, db, storageClient }) => {
      const user = await createTestUser(app, db);

      const pricingClient = new RealScrydexClient({
        apiKey: 'test-key',
        teamId: 'test-team',
        fetch: async () => Response.json({ data: null }),
      });

      const realApp = new App({ db, storageClient, pricingClient }).app;
      const created = await createCardRequest(realApp, user.sessionToken);
      expect(created.status).toBe(503);
      expect(await created.json()).toMatchObject({ code: 'PRICING_PROVIDER_UNAVAILABLE' });

      const savedCards = await db.query.card.findMany();
      expect(savedCards).toHaveLength(1);

      const saved = savedCards[0];

      assert(saved != null, 'Expected persisted card');

      const updated = await realApp.request(`${LIST_CARDS_ROUTE_PATH}/${saved.id}`, {
        method: 'PUT',
        headers: sessionHeaders(user.sessionToken),
        body: JSON.stringify({
          game: saved.game,
          name: 'Updated card',
          set_name: saved.setName,
          card_number: saved.cardNumber,
          purchases: [{ condition: 'near_mint', quantity: 1, purchase_price: null, currency: null }],
        }),
      });

      expect(updated.status).toBe(503);
      expect(await updated.json()).toMatchObject({ code: 'PRICING_PROVIDER_UNAVAILABLE' });
      expect(await db.query.card.findFirst({ where: { id: saved.id } })).toMatchObject({ name: 'Updated card' });
    },
  );

  for (const operation of ['card_lookup', 'search'] as const) {
    integrationTest(
      `keeps cards visible and logs provider failures during ${operation}`,
      async ({ app, db, storageClient, withRequestId, getLogsForRequestId }) => {
        const user = await createTestUser(app, db);
        const failed = CardSchema.parse(await (await createCardRequest(app, user.sessionToken)).json());
        const successful = CardSchema.parse(await (await createCardRequest(app, user.sessionToken)).json());
        await db
          .update(card)
          .set({
            pricingCardId: operation === 'card_lookup' ? 'bad' : null,
            pricingSource: operation === 'card_lookup' ? 'scrydex_real' : null,
          })
          .where(eq(card.id, failed.id));
        await db
          .update(card)
          .set({ game: 'pokemon', pricingCardId: providerCard.id, pricingSource: 'scrydex_real' })
          .where(eq(card.id, successful.id));

        const pricingClient = new RealScrydexClient({
          apiKey: 'test-key',
          teamId: 'test-team',
          fetch: async input => {
            const url = new URL(input instanceof Request ? input.url : input.toString());

            return url.pathname.endsWith(providerCard.id)
              ? Response.json({ data: providerCard })
              : Response.json({ data: null });
          },
        });

        const realApp = new App({ db, storageClient, pricingClient }).app;
        const { headers, requestId } = withRequestId(Object.fromEntries(sessionHeaders(user.sessionToken).entries()));
        const response = await realApp.request(LIST_CARDS_ROUTE_PATH, { headers });
        expect(response.status).toBe(200);
        const body = CardsListResponseSchema.parse(await response.json());
        expect(body.cards.map(value => value.id)).toEqual([successful.id, failed.id]);
        expect(body.cards[0]?.price.status).toBe('priced');
        expect(body.cards[1]?.price).toEqual({ card_id: failed.id, status: 'unavailable' });
        expect(await db.query.cardPrice.findMany({ where: { pricingSource: 'scrydex_real' } })).toHaveLength(1);
        const logs = getLogsForRequestId(requestId);
        expect(logs).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              event: 'pricing.provider.request_completed',
              outcome: 'failure',
              provider_operation: operation,
              error_code: 'PRICING_PROVIDER_UNAVAILABLE',
            }),
            expect.objectContaining({
              event: 'pricing.lock.completed',
              outcome: 'failure',
              lock_status: 'acquired',
              error_code: 'PRICING_PROVIDER_UNAVAILABLE',
            }),
          ]),
        );
        expect(logs).not.toEqual(
          expect.arrayContaining([expect.objectContaining({ error_code: 'PRICING_LOCK_UNAVAILABLE' })]),
        );
      },
    );
  }
});

class UnexpectedPricingClient extends StaticScrydexClient {
  override async getCardById(): Promise<never> {
    throw new Error('Unexpected pricing operation failure');
  }
}
