import { eq } from 'drizzle-orm';
import { Client } from 'pg';
import { z } from 'zod';

import { createCardRequest, sessionHeaders, validCardPayload } from './utils.ts';
import { todayUTC } from '../../card-pricing/utils/query.ts';
import { CONTENTFUL_STATUS_CODES } from '../../constants/http.ts';
import { card } from '../../db/schema/cards.ts';
import { expectErrorResponse } from '../../tests/auth.ts';
import { integrationTest } from '../../tests/fixtures.ts';
import { createTestUser } from '../../tests/utils.ts';
import { LIST_CARDS_ROUTE_PATH } from '../routes/list-cards.ts';
import { CardSchema } from '../schemas/responses.ts';
import { CardsListResponseSchema } from '../schemas/responses.ts';

describe('List cards integration', () => {
  integrationTest('requires an authenticated session', async ({ app }) => {
    const response = await app.request(LIST_CARDS_ROUTE_PATH);
    expect(await expectErrorResponse(response, CONTENTFUL_STATUS_CODES.UNAUTHORIZED)).toMatchObject({
      code: 'SESSION_NOT_FOUND',
    });
  });

  integrationTest('returns an empty collection for a fresh user', async ({ app, db }) => {
    const user = await createTestUser(app, db);
    const response = await app.request(LIST_CARDS_ROUTE_PATH, { headers: sessionHeaders(user.sessionToken) });
    expect(response.status).toBe(CONTENTFUL_STATUS_CODES.OK);
    expect(CardsListResponseSchema.parse(await response.json())).toEqual({ cards: [], available_set_names: [] });
  });

  integrationTest(
    'returns only the session user cards newest first and logs success',
    async ({ app, db, getLogsForRequestId, withRequestId }) => {
      const owner = await createTestUser(app, db);
      const otherUser = await createTestUser(app, db);
      const first = CardSchema.parse(await (await createCardRequest(app, owner.sessionToken)).json());

      const second = CardSchema.parse(
        await (
          await createCardRequest(app, owner.sessionToken, {
            ...validCardPayload,
            game: 'pokemon',
            name: 'Pikachu',
            set_name: 'Base Set',
            card_number: '58/102',
            quantities: [{ condition: 'mint', quantity: 1 }],
          })
        ).json(),
      );

      await createCardRequest(app, otherUser.sessionToken);

      const { headers, requestId } = withRequestId(Object.fromEntries(sessionHeaders(owner.sessionToken).entries()));
      const response = await app.request(LIST_CARDS_ROUTE_PATH, { headers });
      const body = CardsListResponseSchema.parse(await response.json());

      expect(body.cards.map(card => card.id)).toEqual([second.id, first.id]);
      expect(body.cards[0]?.quantities).toEqual([{ condition: 'mint', quantity: 1 }]);
      expect(body.cards.map(card => card.price.card_id)).toEqual([second.id, first.id]);
      expect(getLogsForRequestId(requestId)).toEqual(
        expect.arrayContaining([expect.objectContaining({ event: 'cards.list', result_count: 2 })]),
      );
    },
  );

  integrationTest('filters the session user collection by game', async ({ app, db }) => {
    const owner = await createTestUser(app, db);
    const onePiece = CardSchema.parse(await (await createCardRequest(app, owner.sessionToken)).json());
    await createCardRequest(app, owner.sessionToken, {
      ...validCardPayload,
      game: 'pokemon',
      name: 'Pikachu',
      set_name: 'Base Set',
      card_number: '58/102',
    });

    const response = await app.request(`${LIST_CARDS_ROUTE_PATH}?game=one_piece`, {
      headers: sessionHeaders(owner.sessionToken),
    });

    expect(response.status).toBe(CONTENTFUL_STATUS_CODES.OK);
    const body = CardsListResponseSchema.parse(await response.json());
    expect(body.cards.map(card => card.id)).toEqual([onePiece.id]);
    expect(body.cards[0]?.price.card_id).toBe(onePiece.id);
  });

  integrationTest(
    'combines game and repeated exact sets while retaining all owned set choices',
    async ({ app, db }) => {
      const owner = await createTestUser(app, db);
      const otherUser = await createTestUser(app, db);
      const first = CardSchema.parse(await (await createCardRequest(app, owner.sessionToken)).json());
      const specialSet = 'Special, Set & + 日本語';

      const second = CardSchema.parse(
        await (await createCardRequest(app, owner.sessionToken, { ...validCardPayload, set_name: specialSet })).json(),
      );

      await createCardRequest(app, owner.sessionToken, { ...validCardPayload, set_name: 'Unselected set' });
      await createCardRequest(app, owner.sessionToken, { ...validCardPayload, game: 'pokemon' });
      await createCardRequest(app, otherUser.sessionToken, { ...validCardPayload, set_name: 'Other user only' });
      const query = new URLSearchParams({ game: 'one_piece' });
      query.append('set_name', specialSet);
      query.append('set_name', first.set_name);
      query.append('set_name', specialSet);

      const response = await app.request(`${LIST_CARDS_ROUTE_PATH}?${query}`, {
        headers: sessionHeaders(owner.sessionToken),
      });

      expect(response.status).toBe(CONTENTFUL_STATUS_CODES.OK);
      const body = CardsListResponseSchema.parse(await response.json());
      expect(body.cards.map(card => card.id)).toEqual([second.id, first.id]);
      expect(body.cards.map(card => card.price.card_id)).toEqual([second.id, first.id]);
      expect(body.cards.map(card => card.quantities)).toEqual([
        validCardPayload.quantities,
        validCardPayload.quantities,
      ]);
      expect(body.available_set_names).toEqual(['Romance Dawn', specialSet, 'Unselected set']);
    },
  );

  integrationTest('filters one set across games and deduplicates available names', async ({ app, db }) => {
    const owner = await createTestUser(app, db);
    const first = CardSchema.parse(await (await createCardRequest(app, owner.sessionToken)).json());

    const second = CardSchema.parse(
      await (await createCardRequest(app, owner.sessionToken, { ...validCardPayload, game: 'pokemon' })).json(),
    );

    await createCardRequest(app, owner.sessionToken, { ...validCardPayload, set_name: 'Other set' });
    const query = new URLSearchParams({ set_name: first.set_name });

    const response = await app.request(`${LIST_CARDS_ROUTE_PATH}?${query}`, {
      headers: sessionHeaders(owner.sessionToken),
    });

    expect(response.status).toBe(CONTENTFUL_STATUS_CODES.OK);
    const body = CardsListResponseSchema.parse(await response.json());
    expect(body.cards.map(card => card.id)).toEqual([second.id, first.id]);
    expect(body.available_set_names).toEqual(['Other set', 'Romance Dawn']);
  });

  integrationTest('reads cards and set choices once even when no selected sets match', async ({ app, db }) => {
    const owner = await createTestUser(app, db);
    await createCardRequest(app, owner.sessionToken);
    const query = new URLSearchParams();
    query.append('set_name', 'romance dawn');
    query.append('set_name', 'Unknown');
    const queries = vi.spyOn(db.$client, 'query');

    const response = await app.request(`${LIST_CARDS_ROUTE_PATH}?${query}`, {
      headers: sessionHeaders(owner.sessionToken),
    });

    expect(response.status).toBe(CONTENTFUL_STATUS_CODES.OK);
    expect(CardsListResponseSchema.parse(await response.json())).toEqual({
      cards: [],
      available_set_names: ['Romance Dawn'],
    });
    const statements = queries.mock.calls.map(([statement]) => z.object({ text: z.string() }).parse(statement).text);
    expect(statements.filter(statement => statement.includes('from "card"'))).toHaveLength(1);
    queries.mockRestore();
  });

  integrationTest('returns no cards or sets when only other games and users own cards', async ({ app, db }) => {
    const owner = await createTestUser(app, db);
    const otherUser = await createTestUser(app, db);
    await createCardRequest(app, owner.sessionToken, { ...validCardPayload, game: 'pokemon' });
    await createCardRequest(app, otherUser.sessionToken);

    const response = await app.request(`${LIST_CARDS_ROUTE_PATH}?game=one_piece`, {
      headers: sessionHeaders(owner.sessionToken),
    });

    expect(response.status).toBe(CONTENTFUL_STATUS_CODES.OK);
    expect(CardsListResponseSchema.parse(await response.json())).toEqual({ cards: [], available_set_names: [] });
  });

  for (const setName of ['', 'x'.repeat(201)]) {
    integrationTest(`rejects a set name with ${setName.length} characters`, async ({ app, db }) => {
      const owner = await createTestUser(app, db);
      const query = new URLSearchParams({ set_name: setName });

      const response = await app.request(`${LIST_CARDS_ROUTE_PATH}?${query}`, {
        headers: sessionHeaders(owner.sessionToken),
      });

      expect(await expectErrorResponse(response, CONTENTFUL_STATUS_CODES.BAD_REQUEST)).toMatchObject({
        code: 'INVALID_PAYLOAD',
      });
    });
  }

  integrationTest(
    'returns cards with unavailable pricing when a pricing lock times out',
    async ({ app, connectionString, db }) => {
      const user = await createTestUser(app, db);
      const created = CardSchema.parse(await (await createCardRequest(app, user.sessionToken)).json());
      const pricingCardId = 'one-piece-pricing-lock-test';
      await db.update(card).set({ pricingCardId, pricingSource: 'scrydex_static' }).where(eq(card.id, created.id));

      const lockHolder = new Client({ connectionString });
      await lockHolder.connect();

      try {
        await lockHolder.query('begin');
        await lockHolder.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [
          `pricing:card:scrydex_static:${todayUTC()}:one_piece:${pricingCardId}`,
        ]);

        const response = await app.request(LIST_CARDS_ROUTE_PATH, { headers: sessionHeaders(user.sessionToken) });
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
