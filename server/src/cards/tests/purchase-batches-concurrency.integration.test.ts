import assert from 'node:assert/strict';

import { eq } from 'drizzle-orm';

import { createCardRequest, sessionHeaders } from './utils.ts';
import App from '../../app.ts';
import { RealScrydexClient } from '../../card-pricing/scrydex/real-client.ts';
import type { InjectedContext } from '../../context.ts';
import { card, cardPurchaseBatch } from '../../db/schema/cards.ts';
import { integrationTest } from '../../tests/fixtures.ts';
import { createTestUser } from '../../tests/utils.ts';
import { CardSchema } from '../schemas/responses.ts';

type PendingPricingSetup = Pick<InjectedContext, 'db' | 'storageClient'> & { app: App['app'] };

async function pendingPricing({ app, db, storageClient }: PendingPricingSetup) {
  const user = await createTestUser(app, db);
  const owned = CardSchema.parse(await (await createCardRequest(app, user.sessionToken)).json());
  const batch = owned.purchases[0];
  assert(batch != null);
  await db
    .update(cardPurchaseBatch)
    .set({ purchasePrice: null, currency: null, automaticPriceDate: null })
    .where(eq(cardPurchaseBatch.cardId, owned.id));
  await db.update(card).set({ pricingCardId: 'pending', pricingSource: 'scrydex_real' }).where(eq(card.id, owned.id));
  const requested = Promise.withResolvers<undefined>();
  const release = Promise.withResolvers<undefined>();

  const provider = new RealScrydexClient({
    apiKey: 'test',
    teamId: 'test',
    fetch: async () => {
      requested.resolve(undefined);
      await release.promise;

      return Response.json({
        status: 'success',
        data: {
          id: 'pending',
          name: owned.name,
          number: owned.card_number,
          variants: [{ name: 'normal', prices: [{ condition: 'NM', type: 'raw', currency: 'USD', market: 5 }] }],
        },
      });
    },
  });

  const pending = new App({ db, storageClient, pricingClient: provider }).app.request('/app-api/cards', {
    headers: sessionHeaders(user.sessionToken),
  });

  await requested.promise;

  return { owned, batch, pending, release };
}

integrationTest(
  'a manual price saved while provider pricing is pending wins over backfill',
  async ({ app, db, storageClient }) => {
    const { batch, pending, release } = await pendingPricing({ app, db, storageClient });
    await db
      .update(cardPurchaseBatch)
      .set({ purchasePrice: '4', currency: 'USD' })
      .where(eq(cardPurchaseBatch.id, batch.id));
    release.resolve(undefined);
    expect((await pending).status).toBe(200);
    expect(await db.query.cardPurchaseBatch.findFirst({ where: { id: batch.id } })).toMatchObject({
      purchasePrice: '4.000000',
      currency: 'USD',
      automaticPriceDate: null,
    });
  },
);

integrationTest(
  'pricing for an old card identity cannot backfill a changed card',
  async ({ app, db, storageClient }) => {
    const { owned, batch, pending, release } = await pendingPricing({ app, db, storageClient });
    await db.update(card).set({ name: 'Different card' }).where(eq(card.id, owned.id));
    release.resolve(undefined);
    expect((await pending).status).toBe(200);
    expect(await db.query.cardPurchaseBatch.findFirst({ where: { id: batch.id } })).toMatchObject({
      purchasePrice: null,
      currency: null,
      automaticPriceDate: null,
    });
  },
);
