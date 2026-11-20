import { drizzle } from 'drizzle-orm/node-postgres';

import { createCardRequest, requestOwnedPrices, validCardPayload } from './utils.ts';
import { StaticScrydexClient } from '../../card-pricing/scrydex/static-client.ts';
import { cardPurchaseBatch } from '../../db/schema/cards.ts';
import { appRelations } from '../../db/schema/index.ts';
import { integrationTest } from '../../tests/fixtures.ts';
import { OwnedCardPricesSchema } from '../schemas/responses.ts';
import { CARD_CONDITION_MAP } from '../types.ts';

integrationTest(
  'loads purchase batches in one read and skips cost writes and provider calls on cached collections',
  async ({ app, db, storageClient, createApp, user, authenticatedHeaders }) => {
    for (let index = 0; index < 12; index += 1) {
      const created = await createCardRequest(app, user.sessionToken, validCardPayload);
      expect(created.status).toBe(201);
    }

    const recorded = await db.query.cardPurchaseBatch.findMany();
    expect(recorded).toHaveLength(24);
    expect(recorded.every(batch => batch.purchasePrice != null)).toBe(true);
    const queries: string[] = [];

    const observedDB = drizzle({
      client: db.$client,
      relations: appRelations,
      logger: { logQuery: query => queries.push(query) },
    });

    const provider = new StaticScrydexClient();
    const search = vi.spyOn(provider, 'searchCards');
    const lookup = vi.spyOn(provider, 'getCardById');
    const observed = createApp({ db: observedDB, pricingClient: provider, storageClient });
    const response = await observed.request('/app-api/cards', { headers: authenticatedHeaders });
    expect(response.status).toBe(200);
    expect(queries.filter(query => query.includes('card_purchase_batch'))).toHaveLength(1);
    expect(queries.filter(query => query.includes('update "card_purchase_batch"'))).toHaveLength(0);
    expect(search).not.toHaveBeenCalled();
    expect(lookup).not.toHaveBeenCalled();
    await db.update(cardPurchaseBatch).set({ purchasePrice: null, currency: null, automaticPriceDate: null });
    queries.length = 0;

    const refreshed = await requestOwnedPrices(observed, authenticatedHeaders, [
      ...new Set(recorded.map(batch => batch.cardId)),
    ]);

    expect(refreshed.status).toBe(200);
    expect(queries.filter(query => query.includes('card_purchase_batch'))).toHaveLength(2);
    expect(queries.filter(query => query.includes('update "card_purchase_batch"'))).toHaveLength(1);
    expect(search).not.toHaveBeenCalled();
    expect(lookup).not.toHaveBeenCalled();

    const {
      prices: [first],
    } = OwnedCardPricesSchema.parse(await refreshed.json());

    const nearMint = first?.purchases.find(batch => batch.condition === CARD_CONDITION_MAP.NEAR_MINT);
    const played = first?.purchases.find(batch => batch.condition === CARD_CONDITION_MAP.PLAYED);

    expect(nearMint?.purchase_price).toEqual(expect.any(String));
    expect(played?.purchase_price).toEqual(expect.any(String));
    expect(Number(played?.purchase_price)).toBeCloseTo(Number(nearMint?.purchase_price) * 0.9 ** 3, 5);
    expect(first?.price.valuation?.estimated).toBe(true);
    expect(first?.price.valuation?.amount).toBeCloseTo(
      Number(nearMint?.purchase_price) * 2 + Number(played?.purchase_price),
      6,
    );
    expect(played?.automatic_price_date).toBe(first?.price.priced_card?.priced_on.slice(0, 10));
  },
);
