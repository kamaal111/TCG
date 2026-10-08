import { drizzle } from 'drizzle-orm/node-postgres';

import { createCardRequest, sessionHeaders } from './utils.ts';
import App from '../../app.ts';
import { StaticScrydexClient } from '../../card-pricing/scrydex/static-client.ts';
import { cardPurchaseBatch } from '../../db/schema/cards.ts';
import { appRelations } from '../../db/schema/index.ts';
import { integrationTest } from '../../tests/fixtures.ts';
import { createTestUser } from '../../tests/utils.ts';

integrationTest(
  'loads purchase batches in one read and skips cost writes and provider calls on cached collections',
  async ({ app, db, storageClient }) => {
    const user = await createTestUser(app, db);

    for (let index = 0; index < 12; index += 1) {
      const created = await createCardRequest(app, user.sessionToken);
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
    const observed = new App({ db: observedDB, pricingClient: provider, storageClient }).app;
    const response = await observed.request('/app-api/cards', { headers: sessionHeaders(user.sessionToken) });
    expect(response.status).toBe(200);
    expect(queries.filter(query => query.includes('card_purchase_batch'))).toHaveLength(1);
    expect(queries.filter(query => query.includes('update "card_purchase_batch"'))).toHaveLength(0);
    expect(search).not.toHaveBeenCalled();
    expect(lookup).not.toHaveBeenCalled();
    await db.update(cardPurchaseBatch).set({ purchasePrice: null, currency: null, automaticPriceDate: null });
    queries.length = 0;
    const refreshed = await observed.request('/app-api/cards', { headers: sessionHeaders(user.sessionToken) });
    expect(refreshed.status).toBe(200);
    expect(queries.filter(query => query.includes('card_purchase_batch'))).toHaveLength(2);
    expect(queries.filter(query => query.includes('update "card_purchase_batch"'))).toHaveLength(1);
    expect(search).not.toHaveBeenCalled();
    expect(lookup).not.toHaveBeenCalled();
  },
);
