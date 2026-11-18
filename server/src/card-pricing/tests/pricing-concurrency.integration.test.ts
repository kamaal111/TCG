import assert from 'node:assert/strict';

import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import {
  CardsListResponseSchema,
  OwnedCardPricesSchema,
  OwnedCardDetailsSchema,
} from '../../cards/schemas/responses.ts';
import { createTestCard, requestOwnedPrices } from '../../cards/tests/utils.ts';
import { BinderPageCardsSchema } from '../../collections/schemas/responses.ts';
import { createTestCollection, readCollection } from '../../collections/tests/utils.ts';
import { cardPrice } from '../../db/schema/card-pricing.ts';
import { appRelations } from '../../db/schema/index.ts';
import { createNodeApplication } from '../../runtime/node/app.ts';
import { deferred } from '../../tests/async.ts';
import { integrationTest } from '../../tests/fixtures.ts';
import { trackPoolShutdown } from '../../utils/pool-shutdown.ts';
import type { PricingClient } from '../client.ts';
import { StaticScrydexClient } from '../scrydex/static-client.ts';

integrationTest(
  'card reads finish during concurrent cold price requests with two application connections',
  async ({ app, db, user, authenticatedHeaders: headers, connectionString, storageClient }) => {
    const collection = await createTestCollection(app, headers);

    const inputs = [
      { name: 'Giratina VSTAR', card_number: 'GG69', set_name: 'Crown Zenith' },
      { name: 'Charizard ex', card_number: '199', set_name: '151' },
    ];

    const ids: string[] = [];

    for (const input of [...inputs, ...inputs]) {
      const owned = await createTestCard(app, user.sessionToken, {
        ...input,
        game: 'pokemon',
        collection_id: collection.id,
        purchases: [{ condition: 'near_mint', quantity: 1, purchase_price: null, currency: null }],
      });

      ids.push(owned.id);
    }

    const layout = await readCollection(app, headers, collection.id);
    const [page] = layout.pages;
    assert(page != null);
    await db.delete(cardPrice);
    const pool = new Pool({ connectionString, max: 2, connectionTimeoutMillis: 200 });
    const closePool = trackPoolShutdown(pool);
    const pricingClient = new DelayedCardClient();

    const composed = createNodeApplication({
      db: drizzle({ client: pool, relations: appRelations }),
      storageClient,
      pricingClient,
    });

    const requests = [
      Promise.resolve(requestOwnedPrices(composed.app, headers, ids)),
      Promise.resolve(requestOwnedPrices(composed.app, headers, ids)),
    ];

    try {
      await pricingClient.started;
      const [id] = ids;
      assert(id != null);

      const list = await composed.app.request('/app-api/cards', { headers });
      const details = await composed.app.request(`/app-api/cards/${id}`, { headers });
      const binder = await composed.app.request(`/app-api/collections/${collection.id}/pages/${page.id}`, { headers });

      expect([list.status, details.status, binder.status]).toEqual([200, 200, 200]);
      expect(CardsListResponseSchema.parse(await list.json()).cards).toHaveLength(4);
      expect(OwnedCardDetailsSchema.parse(await details.json()).id).toBe(id);
      expect(BinderPageCardsSchema.parse(await binder.json()).cards).toHaveLength(4);

      pricingClient.release();
      const results = await Promise.all(requests);

      for (const response of results) {
        expect(response.status).toBe(200);
        const { prices } = OwnedCardPricesSchema.parse(await response.json());
        expect(prices.map(entry => entry.price.status)).toEqual(Array(4).fill('priced'));
      }

      expect([...pricingClient.calls.values()]).toEqual([1, 1]);
    } finally {
      pricingClient.release();
      await Promise.allSettled(requests);
      await composed.dispose();
      await closePool();
    }
  },
);

class DelayedCardClient extends StaticScrydexClient {
  private readonly gate = deferred<undefined>();
  private readonly startedGate = deferred<undefined>();
  readonly started = this.startedGate.promise;
  readonly calls = new Map<string, number>();

  override async getCardById(game: Parameters<PricingClient['getCardById']>[0], id: string) {
    this.calls.set(id, (this.calls.get(id) ?? 0) + 1);
    this.startedGate.resolve(undefined);
    await this.gate.promise;

    return super.getCardById(game, id);
  }

  release() {
    this.gate.resolve(undefined);
  }
}
