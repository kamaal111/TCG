import assert from 'node:assert/strict';

import { eq } from 'drizzle-orm';

import { createTestCard } from './utils.ts';
import { createTestScrydexClient } from '../../card-pricing/tests/utils.ts';
import type { Database } from '../../db/index.ts';
import { card, cardPurchaseBatch } from '../../db/schema/cards.ts';
import type App from '../../runtime/node/app.ts';
import { sessionHeaders } from '../../tests/auth.ts';
import { integrationTest } from '../../tests/fixtures.ts';

interface PendingPricingSetup {
  db: Database;
  app: App['app'];
  sessionToken: string;
  createApp: (overrides?: ConstructorParameters<typeof App>[0]) => App['app'];
}

async function pendingPricing({ app, db, sessionToken, createApp }: PendingPricingSetup) {
  const owned = await createTestCard(app, sessionToken);
  const batch = owned.purchases[0];
  assert(batch != null);
  await db
    .update(cardPurchaseBatch)
    .set({ purchasePrice: null, currency: null, automaticPriceDate: null })
    .where(eq(cardPurchaseBatch.cardId, owned.id));
  await db.update(card).set({ pricingCardId: 'pending', pricingSource: 'scrydex_real' }).where(eq(card.id, owned.id));
  const requested = Promise.withResolvers<undefined>();
  const release = Promise.withResolvers<undefined>();

  const provider = createTestScrydexClient(async () => {
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
  });

  const pending = createApp({ pricingClient: provider }).request('/app-api/cards', {
    headers: sessionHeaders(sessionToken),
  });

  await requested.promise;

  return { owned, batch, pending, release };
}

integrationTest(
  'a manual price saved while provider pricing is pending wins over backfill',
  async ({ app, db, user, createApp }) => {
    const { batch, pending, release } = await pendingPricing({ app, db, sessionToken: user.sessionToken, createApp });
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
  async ({ app, db, user, createApp }) => {
    const { owned, batch, pending, release } = await pendingPricing({
      app,
      db,
      sessionToken: user.sessionToken,
      createApp,
    });

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
