import assert from 'node:assert/strict';

import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import { CardsListResponseSchema } from '../../cards/schemas/responses.ts';
import { createTestCard } from '../../cards/tests/utils.ts';
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
  'overlapping cold card lists and binder pages preserve authentication and deduplicate prices with two application connections',
  async ({ app, db, user, authenticatedHeaders: headers, connectionString, storageClient }) => {
    const collection = await createTestCollection(app, headers);

    const inputs = [
      { name: 'Giratina VSTAR', card_number: 'GG69', set_name: 'Crown Zenith A' },
      { name: 'Charizard ex', card_number: '199', set_name: '151 A' },
      { name: 'Giratina VSTAR', card_number: 'GG69', set_name: 'Crown Zenith B' },
      { name: 'Charizard ex', card_number: '199', set_name: '151 B' },
    ];

    for (const input of inputs) {
      await createTestCard(app, user.sessionToken, {
        ...input,
        game: 'pokemon',
        collection_id: collection.id,
        purchases: [{ condition: 'near_mint', quantity: 1, purchase_price: null, currency: null }],
      });
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
      Promise.resolve(composed.app.request('/app-api/cards', { headers })),
      Promise.resolve(composed.app.request('/app-api/cards', { headers })),
      Promise.resolve(composed.app.request(`/app-api/collections/${collection.id}/pages/${page.id}`, { headers })),
    ];

    try {
      await pricingClient.started;
      const authentication = await composed.app.request('/app-api/collections', { headers });

      expect(authentication.status).toBe(200);
      pricingClient.release();
      const [first, second, binder] = await Promise.all(requests);
      assert(first != null && second != null && binder != null);

      expect([first.status, second.status, binder.status]).toEqual([200, 200, 200]);

      const lists = [
        CardsListResponseSchema.parse(await first.json()),
        CardsListResponseSchema.parse(await second.json()),
      ];

      const binderCards = BinderPageCardsSchema.parse(await binder.json());

      expect(lists.map(list => list.cards.length)).toEqual([4, 4]);
      expect(binderCards.cards).toHaveLength(4);
      expect(lists.flatMap(list => list.cards.map(card => card.price.status))).toEqual(Array(8).fill('priced'));
      expect(binderCards.cards.map(card => card.price.status)).toEqual(Array(4).fill('priced'));
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
