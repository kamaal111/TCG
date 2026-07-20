import type { Hono } from 'hono';

import { STATUS_CODES } from '../../constants/http.ts';
import { MIME_TYPES } from '../../constants/request.ts';
import type { HonoEnvironment } from '../../context.ts';
import { expectErrorResponse } from '../../tests/auth.ts';
import { integrationTest } from '../../tests/fixtures.ts';
import { createTestUser } from '../../tests/utils.ts';
import { CREATE_CARD_ROUTE_PATH } from '../handlers/create-card.ts';
import { DELETE_CARD_ROUTE_PATH } from '../handlers/delete-card.ts';
import { CardSchema, DeleteCardResponseSchema } from '../schemas/responses.ts';

const CREATE_PAYLOAD = {
  game: 'one_piece',
  name: 'Monkey D. Luffy',
  set_name: 'Romance Dawn',
  card_number: 'OP01-003',
  quantities: [
    { condition: 'near_mint', quantity: 2 },
    { condition: 'played', quantity: 1 },
  ],
};

describe('Delete card integration', () => {
  integrationTest('returns a not-found error without an authenticated session', async ({ app }) => {
    const response = await sendDeleteCardRequest(app, 'some-card-id');

    const body = await expectErrorResponse(response, STATUS_CODES.NOT_FOUND);

    expect(body).toEqual({ message: 'Not found', code: 'NOT_FOUND' });
  });

  integrationTest('returns a card-not-found error for an unknown card id', async ({ app, db }) => {
    const { sessionToken } = await createTestUser(app, db);

    const response = await sendDeleteCardRequest(app, crypto.randomUUID(), sessionHeaders(sessionToken));

    const body = await expectErrorResponse(response, STATUS_CODES.NOT_FOUND);
    expect(body).toEqual({ message: 'Card not found', code: 'CARD_NOT_FOUND' });
  });

  integrationTest("returns a card-not-found error for another user's card", async ({ app, db }) => {
    const userA = await createTestUser(app, db);
    const userB = await createTestUser(app, db);
    const createdCard = await createCard(app, userA.sessionToken, CREATE_PAYLOAD);

    const response = await sendDeleteCardRequest(app, createdCard.id, sessionHeaders(userB.sessionToken));

    const body = await expectErrorResponse(response, STATUS_CODES.NOT_FOUND);
    expect(body).toEqual({ message: 'Card not found', code: 'CARD_NOT_FOUND' });
    const persistedCard = await db.query.card.findFirst({ where: { id: createdCard.id } });
    expect(persistedCard).toBeDefined();
  });

  integrationTest(
    'deletes the card and cascades its quantities',
    async ({ app, db, getLogsForRequestId, withRequestId }) => {
      const createdUser = await createTestUser(app, db);
      const cardToDelete = await createCard(app, createdUser.sessionToken, CREATE_PAYLOAD);
      const cardToKeep = await createCard(app, createdUser.sessionToken, {
        ...CREATE_PAYLOAD,
        name: 'Roronoa Zoro',
        card_number: 'OP01-025',
      });
      const { headers, requestId } = withRequestId(sessionHeaders(createdUser.sessionToken));

      const response = await sendDeleteCardRequest(app, cardToDelete.id, headers);

      expect(response.status).toBe(STATUS_CODES.OK);
      expect(DeleteCardResponseSchema.parse(await response.json())).toEqual({});

      const deletedCard = await db.query.card.findFirst({ where: { id: cardToDelete.id } });
      expect(deletedCard).toBeUndefined();
      const orphanedQuantities = await db.query.cardConditionQuantity.findMany({
        where: { cardId: cardToDelete.id },
      });
      expect(orphanedQuantities).toEqual([]);
      const keptCard = await db.query.card.findFirst({
        where: { id: cardToKeep.id },
        with: { quantities: true },
      });
      expect(keptCard).toBeDefined();
      expect(keptCard?.quantities).toHaveLength(2);
      expect(getLogsForRequestId(requestId)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            event: 'cards.delete',
            msg: 'Deleted card entry successfully.',
            request_id: requestId,
            component: 'cards',
            outcome: 'success',
            user_id: createdUser.userId,
          }),
        ]),
      );
    },
  );
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

  return CardSchema.parse(await response.json());
}

async function sendDeleteCardRequest(app: Hono<HonoEnvironment>, cardId: string, headers?: HeadersInit) {
  return app.request(DELETE_CARD_ROUTE_PATH.replace('{cardId}', cardId), {
    method: 'DELETE',
    headers: headers == null ? undefined : new Headers(headers),
  });
}
