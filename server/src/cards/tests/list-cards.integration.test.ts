import { eq } from 'drizzle-orm';
import { Client } from 'pg';

import { createCardRequest, sessionHeaders, validCardPayload } from './utils.ts';
import { todayUTC } from '../../card-pricing/utils/query.ts';
import { STATUS_CODES } from '../../constants/http.ts';
import { card } from '../../db/schema/cards.ts';
import { expectErrorResponse } from '../../tests/auth.ts';
import { integrationTest } from '../../tests/fixtures.ts';
import { createTestUser } from '../../tests/utils.ts';
import { LIST_CARDS_ROUTE_PATH } from '../handlers/list-cards.ts';
import { CardSchema } from '../schemas/responses.ts';
import { CardsListResponseSchema } from '../schemas/responses.ts';

describe('List cards integration', () => {
  integrationTest('requires an authenticated session', async ({ app }) => {
    const response = await app.request(LIST_CARDS_ROUTE_PATH);
    expect(await expectErrorResponse(response, STATUS_CODES.UNAUTHORIZED)).toMatchObject({
      code: 'SESSION_NOT_FOUND',
    });
  });

  integrationTest('returns an empty collection for a fresh user', async ({ app, db }) => {
    const user = await createTestUser(app, db);
    const response = await app.request(LIST_CARDS_ROUTE_PATH, { headers: sessionHeaders(user.sessionToken) });
    expect(response.status).toBe(STATUS_CODES.OK);
    expect(CardsListResponseSchema.parse(await response.json())).toEqual({ cards: [] });
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

    expect(response.status).toBe(STATUS_CODES.OK);
    const body = CardsListResponseSchema.parse(await response.json());
    expect(body.cards.map(card => card.id)).toEqual([onePiece.id]);
    expect(body.cards[0]?.price.card_id).toBe(onePiece.id);
  });

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

        expect(response.status).toBe(STATUS_CODES.OK);
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
