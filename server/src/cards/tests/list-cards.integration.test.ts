import { STATUS_CODES } from '../../constants/http.ts';
import { expectErrorResponse } from '../../tests/auth.ts';
import { integrationTest } from '../../tests/fixtures.ts';
import { createTestUser } from '../../tests/utils.ts';
import { LIST_CARDS_ROUTE_PATH } from '../handlers/list-cards.ts';
import { CardsListResponseSchema } from '../schemas/responses.ts';
import { createCardRequest, sessionHeaders, validCardPayload } from './utils.ts';
import { CardSchema } from '../schemas/responses.ts';

describe('List cards integration', () => {
  integrationTest('requires an authenticated session', async ({ app }) => {
    const response = await app.request(LIST_CARDS_ROUTE_PATH);
    expect(await expectErrorResponse(response, STATUS_CODES.NOT_FOUND)).toMatchObject({
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
      expect(getLogsForRequestId(requestId)).toEqual(
        expect.arrayContaining([expect.objectContaining({ event: 'cards.list', card_count: 2 })]),
      );
    },
  );
});
