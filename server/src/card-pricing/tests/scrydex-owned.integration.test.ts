import assert from 'node:assert/strict';

import { eq } from 'drizzle-orm';

import { createTestScrydexClient } from './utils.ts';
import { LIST_CARDS_ROUTE_PATH } from '../../cards/routes/list-cards.ts';
import { OwnedCardPricesSchema } from '../../cards/schemas/responses.ts';
import {
  createCardRequest,
  createTestCard,
  requestOwnedPrices,
  seedCatalogPrinting,
  validCardPayload,
} from '../../cards/tests/utils.ts';
import { cardPrice } from '../../db/schema/card-pricing.ts';
import { card } from '../../db/schema/cards.ts';
import { integrationTest } from '../../tests/fixtures.ts';
import { StaticScrydexClient } from '../scrydex/static-client.ts';

const providerCard = {
  id: 'm6_ja-88',
  name: 'ピカチュウ',
  number: '88',
  printed_number: '088/080',
  variants: [{ name: 'holofoil', prices: [{ condition: 'NM', type: 'raw', currency: 'JPY', low: 800 }] }],
};

describe('Scrydex owned-card pricing', () => {
  integrationTest(
    'decodes a daily lookup and reuses the persisted price',
    async ({ app, db, createApp, user, authenticatedHeaders }) => {
      const created = await createTestCard(app, user.sessionToken, validCardPayload);
      await db
        .update(card)
        .set({ game: 'pokemon', pricingCardId: providerCard.id, pricingSource: 'scrydex_real' })
        .where(eq(card.id, created.id));

      let calls = 0;

      const pricingClient = createTestScrydexClient(async input => {
        calls += 1;
        const url = new URL(input instanceof Request ? input.url : input.toString());

        expect(url.pathname).toBe('/pokemon/v1/cards/m6_ja-88');
        expect(url.searchParams.get('include')).toBe('prices');

        return Response.json({ status: 'success', data: providerCard });
      });

      const realApp = createApp({ pricingClient });
      const first = await requestOwnedPrices(realApp, authenticatedHeaders, [created.id]);
      expect(first.status).toBe(200);
      const body = OwnedCardPricesSchema.parse(await first.json());
      expect(body.prices[0]?.price).toMatchObject({
        status: 'priced',
        priced_card: { headline: { amount: 800, currency: 'JPY' } },
      });
      expect(await db.query.cardPrice.findFirst({ where: { pricingSource: 'scrydex_real' } })).toMatchObject({
        raw: providerCard,
      });
      const second = await requestOwnedPrices(realApp, authenticatedHeaders, [created.id]);
      expect(second.status).toBe(200);
      expect(OwnedCardPricesSchema.parse(await second.json())).toEqual(body);
      expect(calls).toBe(1);
    },
  );

  integrationTest(
    'does not hide unexpected collection pricing failures',
    async ({ app, db, withRequestId, getLogsForRequestId, createApp, user, authenticatedHeaders }) => {
      const created = await createTestCard(app, user.sessionToken, validCardPayload);
      await db
        .update(card)
        .set({ pricingCardId: 'uncached', pricingSource: 'scrydex_static' })
        .where(eq(card.id, created.id));

      const realApp = createApp({ pricingClient: new UnexpectedPricingClient() });
      const { headers, requestId } = withRequestId(authenticatedHeaders);
      const response = await requestOwnedPrices(realApp, headers, [created.id]);
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
    'uses the cached printing and allows ownership updates when its price provider is unavailable',
    async ({ db, createApp, user, authenticatedHeaders }) => {
      const pricingClient = createTestScrydexClient(async () => Response.json({ data: null }));

      const realApp = createApp({ pricingClient });
      const printing = await seedCatalogPrinting(db, validCardPayload, 'scrydex_real');

      const created = await createCardRequest(realApp, user.sessionToken, {
        ...validCardPayload,
        priced_card_id: printing.id,
      });

      expect(created.status).toBe(201);
      await db.update(cardPrice).set({ pricedOn: '2025-01-01' }).where(eq(cardPrice.id, printing.id));

      const savedCards = await db.query.card.findMany();
      expect(savedCards).toHaveLength(1);

      const saved = savedCards[0];

      assert(saved != null, 'Expected persisted card');

      const updated = await realApp.request(`${LIST_CARDS_ROUTE_PATH}/${saved.id}`, {
        method: 'PUT',
        headers: authenticatedHeaders,
        body: JSON.stringify({
          notes: 'Updated notes',
          purchases: [{ condition: 'near_mint', quantity: 1, purchase_price: null, currency: null }],
        }),
      });

      expect(updated.status).toBe(200);
      expect(await updated.json()).toMatchObject({ price: { status: 'unavailable' }, name: saved.name });
      expect(await db.query.card.findFirst({ where: { id: saved.id } })).toMatchObject({ notes: 'Updated notes' });
    },
  );

  for (const operation of ['card_lookup', 'search'] as const) {
    integrationTest(
      `keeps cards visible and logs provider failures during ${operation}`,
      async ({ app, db, withRequestId, getLogsForRequestId, createApp, user, authenticatedHeaders }) => {
        const failed = await createTestCard(app, user.sessionToken, validCardPayload);
        const successful = await createTestCard(app, user.sessionToken, validCardPayload);
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

        const pricingClient = createTestScrydexClient(async input => {
          const url = new URL(input instanceof Request ? input.url : input.toString());

          return url.pathname.endsWith(providerCard.id)
            ? Response.json({ data: providerCard })
            : Response.json({ data: null });
        });

        const realApp = createApp({ pricingClient });
        const { headers, requestId } = withRequestId(authenticatedHeaders);
        const response = await requestOwnedPrices(realApp, headers, [failed.id, successful.id]);
        expect(response.status).toBe(200);
        const body = OwnedCardPricesSchema.parse(await response.json());
        expect(new Set(body.prices.map(value => value.id))).toEqual(new Set([successful.id, failed.id]));
        expect(body.prices.find(value => value.id === successful.id)?.price.status).toBe('priced');
        expect(body.prices.find(value => value.id === failed.id)?.price).toEqual({
          card_id: failed.id,
          status: 'unavailable',
        });
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
