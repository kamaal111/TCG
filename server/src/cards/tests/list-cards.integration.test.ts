import type { Hono } from 'hono';

import { STATUS_CODES } from '../../constants/http.ts';
import { MIME_TYPES } from '../../constants/request.ts';
import type { HonoEnvironment } from '../../context.ts';
import { expectErrorResponse } from '../../tests/auth.ts';
import { integrationTest } from '../../tests/fixtures.ts';
import { createTestUser } from '../../tests/utils.ts';
import { CREATE_CARD_ROUTE_PATH } from '../handlers/create-card.ts';
import { LIST_CARDS_ROUTE_PATH } from '../handlers/list-cards.ts';
import { CardsListResponseSchema } from '../schemas/responses.ts';

describe('List cards integration', () => {
  integrationTest('returns a not-found error without an authenticated session', async ({ app }) => {
    const response = await sendListCardsRequest(app);

    const body = await expectErrorResponse(response, STATUS_CODES.NOT_FOUND);

    expect(body).toEqual({ message: 'Not found', code: 'NOT_FOUND' });
  });

  integrationTest('returns an empty list for a fresh user', async ({ app, db }) => {
    const { sessionToken } = await createTestUser(app, db);

    const response = await sendListCardsRequest(app, sessionHeaders(sessionToken));

    expect(response.status).toBe(STATUS_CODES.OK);
    const body = CardsListResponseSchema.parse(await response.json());
    expect(body.cards).toEqual([]);
  });

  integrationTest('returns created cards with quantities ordered newest first', async ({ app, db }) => {
    const { sessionToken } = await createTestUser(app, db);
    await createCard(app, sessionToken, {
      game: 'one_piece',
      name: 'Monkey D. Luffy',
      set_name: 'Romance Dawn',
      card_number: 'OP01-003',
      quantities: [
        { condition: 'near_mint', quantity: 2 },
        { condition: 'played', quantity: 1 },
      ],
    });
    await createCard(app, sessionToken, {
      game: 'pokemon',
      name: 'Pikachu',
      set_name: 'Base Set',
      card_number: '58/102',
      notes: 'First edition',
      quantities: [{ condition: 'mint', quantity: 1 }],
    });

    const response = await sendListCardsRequest(app, sessionHeaders(sessionToken));

    expect(response.status).toBe(STATUS_CODES.OK);
    const body = CardsListResponseSchema.parse(await response.json());
    expect(body.cards.map(card => card.name)).toEqual(['Pikachu', 'Monkey D. Luffy']);
    expect(body.cards[0]).toMatchObject({
      game: 'pokemon',
      set_name: 'Base Set',
      card_number: '58/102',
      notes: 'First edition',
      quantities: [{ condition: 'mint', quantity: 1 }],
    });
    expect(body.cards[1]).toMatchObject({
      game: 'one_piece',
      notes: null,
      quantities: [
        { condition: 'near_mint', quantity: 2 },
        { condition: 'played', quantity: 1 },
      ],
    });
  });

  integrationTest("excludes other users' cards from the list", async ({ app, db }) => {
    const userA = await createTestUser(app, db);
    const userB = await createTestUser(app, db);
    await createCard(app, userA.sessionToken, {
      game: 'one_piece',
      name: 'Monkey D. Luffy',
      set_name: 'Romance Dawn',
      card_number: 'OP01-003',
      quantities: [{ condition: 'near_mint', quantity: 2 }],
    });

    const response = await sendListCardsRequest(app, sessionHeaders(userB.sessionToken));

    expect(response.status).toBe(STATUS_CODES.OK);
    const body = CardsListResponseSchema.parse(await response.json());
    expect(body.cards).toEqual([]);
  });

  integrationTest('logs the list event', async ({ app, db, getLogsForRequestId, withRequestId }) => {
    const createdUser = await createTestUser(app, db);
    const { headers, requestId } = withRequestId(sessionHeaders(createdUser.sessionToken));

    const response = await sendListCardsRequest(app, headers);

    expect(response.status).toBe(STATUS_CODES.OK);
    expect(getLogsForRequestId(requestId)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: 'cards.list',
          msg: 'Listed card entries successfully.',
          request_id: requestId,
          component: 'cards',
          outcome: 'success',
          result_count: 0,
          user_id: createdUser.userId,
        }),
      ]),
    );
  });
});

function sessionHeaders(sessionToken: string): HeadersInit {
  return { Cookie: `better-auth.session_token=${sessionToken}` };
}

async function createCard(app: Hono<HonoEnvironment>, sessionToken: string, payload: unknown) {
  const response = await app.request(CREATE_CARD_ROUTE_PATH, {
    method: 'POST',
    headers: new Headers({
      'Content-Type': MIME_TYPES.JSON,
      Cookie: `better-auth.session_token=${sessionToken}`,
    }),
    body: JSON.stringify(payload),
  });
  if (response.status !== STATUS_CODES.CREATED) {
    throw new Error(`Failed to create test card: HTTP ${response.status} ${await response.text()}`);
  }

  return response.json();
}

async function sendListCardsRequest(app: Hono<HonoEnvironment>, headers?: HeadersInit) {
  return app.request(LIST_CARDS_ROUTE_PATH, {
    method: 'GET',
    headers: headers == null ? undefined : new Headers(headers),
  });
}
