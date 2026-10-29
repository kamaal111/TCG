import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Client } from 'pg';

import { createCardRequest, validCardPayload, createTestCard } from './utils.ts';
import { StaticScrydexClient } from '../../card-pricing/scrydex/static-client.ts';
import { todayUTC } from '../../card-pricing/utils/query.ts';
import { CollectionSchema } from '../../collections/schemas/responses.ts';
import { CONTENTFUL_STATUS_CODES } from '../../constants/http.ts';
import { card } from '../../db/schema/cards.ts';
import { appRelations } from '../../db/schema/index.ts';
import { expectErrorResponse } from '../../tests/auth.ts';
import { integrationTest } from '../../tests/fixtures.ts';
import { LIST_CARDS_ROUTE_PATH } from '../routes/list-cards.ts';
import { CardsListResponseSchema } from '../schemas/responses.ts';

describe('List cards integration', () => {
  integrationTest(
    'searches across collections with owned paginated results and literal wildcard characters',
    async ({ app, user: owner, createUser, authenticatedHeaders: headers }) => {
      const other = await createUser();

      const created = await app.request('/app-api/collections', {
        method: 'POST',
        headers,
        body: JSON.stringify({ name: 'Favorites' }),
      });

      expect(created.status).toBe(201);
      const collection = CollectionSchema.parse(await created.json());
      const unfiled = await createTestCard(app, owner.sessionToken);

      const filed = await createTestCard(app, owner.sessionToken, {
        ...validCardPayload,
        collection_id: collection.id,
        card_number: '50%_Luffy',
      });

      await createCardRequest(app, other.sessionToken);
      const first = await app.request(`${LIST_CARDS_ROUTE_PATH}?query=lUfFy&limit=1`, { headers });
      expect(first.status).toBe(200);
      const page = CardsListResponseSchema.parse(await first.json());
      expect(page.cards.map(card => card.id)).toEqual([filed.id]);
      expect(page.next_cursor).toEqual(expect.any(String));

      const next = await app.request(`${LIST_CARDS_ROUTE_PATH}?query=lUfFy&limit=1&cursor=${page.next_cursor}`, {
        headers,
      });

      expect(next.status).toBe(200);
      const last = CardsListResponseSchema.parse(await next.json());
      expect(last.cards.map(card => card.id)).toEqual([unfiled.id]);
      expect(last.next_cursor).toBeNull();
      const literal = await app.request(`${LIST_CARDS_ROUTE_PATH}?query=${encodeURIComponent('%_')}`, { headers });
      expect(literal.status).toBe(200);
      expect(CardsListResponseSchema.parse(await literal.json()).cards.map(card => card.id)).toEqual([filed.id]);

      const scoped = await app.request(`${LIST_CARDS_ROUTE_PATH}?query=dawn&collection_id=${collection.id}`, {
        headers,
      });

      expect(scoped.status).toBe(200);
      expect(CardsListResponseSchema.parse(await scoped.json()).cards.map(card => card.id)).toEqual([filed.id]);
    },
  );

  integrationTest('requires an authenticated session', async ({ app }) => {
    const response = await app.request(LIST_CARDS_ROUTE_PATH);
    expect(await expectErrorResponse(response, CONTENTFUL_STATUS_CODES.UNAUTHORIZED)).toMatchObject({
      code: 'SESSION_NOT_FOUND',
    });
  });

  integrationTest('returns an empty collection for a fresh user', async ({ app, authenticatedHeaders }) => {
    const response = await app.request(LIST_CARDS_ROUTE_PATH, { headers: authenticatedHeaders });
    expect(response.status).toBe(CONTENTFUL_STATUS_CODES.OK);
    expect(CardsListResponseSchema.parse(await response.json())).toEqual({
      cards: [],
      available_set_names: [],
      next_cursor: null,
    });
  });

  integrationTest(
    'returns only the session user cards newest first and logs success',
    async ({ app, getLogsForRequestId, withRequestId, user: owner, createUser, authenticatedHeaders }) => {
      const otherUser = await createUser();
      const first = await createTestCard(app, owner.sessionToken);

      const second = await createTestCard(app, owner.sessionToken, {
        ...validCardPayload,
        game: 'pokemon',
        name: 'Pikachu',
        set_name: 'Base Set',
        card_number: '58/102',
        purchases: [{ condition: 'mint', quantity: 1, purchase_price: null, currency: null }],
      });

      await createCardRequest(app, otherUser.sessionToken);

      const { headers, requestId } = withRequestId(authenticatedHeaders);
      const response = await app.request(LIST_CARDS_ROUTE_PATH, { headers });
      const body = CardsListResponseSchema.parse(await response.json());

      expect(body.cards.map(card => card.id)).toEqual([second.id, first.id]);
      expect(
        body.cards[0]?.purchases.map(({ condition, quantity }) => ({
          condition,
          quantity,
          purchase_price: null,
          currency: null,
        })),
      ).toEqual([{ condition: 'mint', quantity: 1, purchase_price: null, currency: null }]);
      expect(body.cards.map(card => card.price.card_id)).toEqual([second.id, first.id]);
      expect(getLogsForRequestId(requestId)).toEqual(
        expect.arrayContaining([expect.objectContaining({ event: 'cards.list', result_count: 2 })]),
      );
    },
  );

  integrationTest('filters the session user collection by game', async ({ app, user: owner, authenticatedHeaders }) => {
    const onePiece = await createTestCard(app, owner.sessionToken);
    await createCardRequest(app, owner.sessionToken, {
      ...validCardPayload,
      game: 'pokemon',
      name: 'Pikachu',
      set_name: 'Base Set',
      card_number: '58/102',
    });

    const response = await app.request(`${LIST_CARDS_ROUTE_PATH}?game=one_piece`, {
      headers: authenticatedHeaders,
    });

    expect(response.status).toBe(CONTENTFUL_STATUS_CODES.OK);
    const body = CardsListResponseSchema.parse(await response.json());
    expect(body.cards.map(card => card.id)).toEqual([onePiece.id]);
    expect(body.cards[0]?.price.card_id).toBe(onePiece.id);
  });

  integrationTest(
    'combines game and repeated exact sets while retaining all owned set choices',
    async ({ app, user: owner, createUser, authenticatedHeaders }) => {
      const otherUser = await createUser();
      const first = await createTestCard(app, owner.sessionToken);
      const specialSet = 'Special, Set & + 日本語';

      const second = await createTestCard(app, owner.sessionToken, { ...validCardPayload, set_name: specialSet });

      await createCardRequest(app, owner.sessionToken, { ...validCardPayload, set_name: 'Unselected set' });
      await createCardRequest(app, owner.sessionToken, { ...validCardPayload, game: 'pokemon' });
      await createCardRequest(app, otherUser.sessionToken, { ...validCardPayload, set_name: 'Other user only' });
      const query = new URLSearchParams({ game: 'one_piece' });
      query.append('set_name', specialSet);
      query.append('set_name', first.set_name);
      query.append('set_name', specialSet);

      const response = await app.request(`${LIST_CARDS_ROUTE_PATH}?${query}`, {
        headers: authenticatedHeaders,
      });

      expect(response.status).toBe(CONTENTFUL_STATUS_CODES.OK);
      const body = CardsListResponseSchema.parse(await response.json());
      expect(body.cards.map(card => card.id)).toEqual([second.id, first.id]);
      expect(body.cards.map(card => card.price.card_id)).toEqual([second.id, first.id]);
      expect(
        body.cards.map(card =>
          card.purchases.map(({ condition, quantity }) => ({
            condition,
            quantity,
            purchase_price: null,
            currency: null,
          })),
        ),
      ).toEqual([
        expect.arrayContaining(validCardPayload.purchases),
        expect.arrayContaining(validCardPayload.purchases),
      ]);
      expect(body.available_set_names).toEqual(['Romance Dawn', specialSet, 'Unselected set']);
    },
  );

  integrationTest(
    'filters one set across games and deduplicates available names',
    async ({ app, user: owner, authenticatedHeaders }) => {
      const first = await createTestCard(app, owner.sessionToken);

      const second = await createTestCard(app, owner.sessionToken, { ...validCardPayload, game: 'pokemon' });

      await createCardRequest(app, owner.sessionToken, { ...validCardPayload, set_name: 'Other set' });
      const query = new URLSearchParams({ set_name: first.set_name });

      const response = await app.request(`${LIST_CARDS_ROUTE_PATH}?${query}`, {
        headers: authenticatedHeaders,
      });

      expect(response.status).toBe(CONTENTFUL_STATUS_CODES.OK);
      const body = CardsListResponseSchema.parse(await response.json());
      expect(body.cards.map(card => card.id)).toEqual([second.id, first.id]);
      expect(body.available_set_names).toEqual(['Other set', 'Romance Dawn']);
    },
  );

  integrationTest(
    'reads a bounded card page and complete set choices when no selected sets match',
    async ({ app, db, createApp, user: owner, authenticatedHeaders }) => {
      await createCardRequest(app, owner.sessionToken);
      const query = new URLSearchParams();
      query.append('set_name', 'romance dawn');
      query.append('set_name', 'Unknown');

      const statements: string[] = [];

      const observedDB = drizzle({
        client: db.$client,
        relations: appRelations,
        logger: { logQuery: query => statements.push(query) },
      });

      const observedApp = createApp({ db: observedDB, pricingClient: new StaticScrydexClient() });

      const response = await observedApp.request(`${LIST_CARDS_ROUTE_PATH}?${query}`, {
        headers: authenticatedHeaders,
      });

      expect(response.status).toBe(CONTENTFUL_STATUS_CODES.OK);
      expect(CardsListResponseSchema.parse(await response.json())).toEqual({
        cards: [],
        available_set_names: ['Romance Dawn'],
        next_cursor: null,
      });
      expect(statements.filter(statement => statement.includes('from "card"'))).toHaveLength(2);
    },
  );

  integrationTest(
    'returns no cards or sets when only other games and users own cards',
    async ({ app, user: owner, createUser, authenticatedHeaders }) => {
      const otherUser = await createUser();
      await createCardRequest(app, owner.sessionToken, { ...validCardPayload, game: 'pokemon' });
      await createCardRequest(app, otherUser.sessionToken);

      const response = await app.request(`${LIST_CARDS_ROUTE_PATH}?game=one_piece`, {
        headers: authenticatedHeaders,
      });

      expect(response.status).toBe(CONTENTFUL_STATUS_CODES.OK);
      expect(CardsListResponseSchema.parse(await response.json())).toEqual({
        cards: [],
        available_set_names: [],
        next_cursor: null,
      });
    },
  );

  for (const setName of ['', 'x'.repeat(201)]) {
    integrationTest(`rejects a set name with ${setName.length} characters`, async ({ app, authenticatedHeaders }) => {
      const query = new URLSearchParams({ set_name: setName });

      const response = await app.request(`${LIST_CARDS_ROUTE_PATH}?${query}`, {
        headers: authenticatedHeaders,
      });

      expect(await expectErrorResponse(response, CONTENTFUL_STATUS_CODES.BAD_REQUEST)).toMatchObject({
        code: 'INVALID_PAYLOAD',
      });
    });
  }

  integrationTest(
    'returns cards with unavailable pricing when a pricing lock times out',
    async ({ app, connectionString, db, user, authenticatedHeaders }) => {
      const created = await createTestCard(app, user.sessionToken);
      const pricingCardId = 'one-piece-pricing-lock-test';
      await db.update(card).set({ pricingCardId, pricingSource: 'scrydex_static' }).where(eq(card.id, created.id));

      const lockHolder = new Client({ connectionString });
      await lockHolder.connect();

      try {
        await lockHolder.query('begin');
        await lockHolder.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [
          `pricing:card:scrydex_static:${todayUTC()}:one_piece:${pricingCardId}`,
        ]);

        const response = await app.request(LIST_CARDS_ROUTE_PATH, { headers: authenticatedHeaders });
        const body = CardsListResponseSchema.parse(await response.json());

        expect(response.status).toBe(CONTENTFUL_STATUS_CODES.OK);
        expect(body.cards).toEqual([
          expect.objectContaining({ id: created.id, price: { card_id: created.id, status: 'unavailable' } }),
        ]);
      } finally {
        await lockHolder.query('rollback');
        await lockHolder.end();
      }
    },
  );
});
