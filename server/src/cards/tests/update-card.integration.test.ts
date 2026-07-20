import type { Hono } from 'hono';

import { STATUS_CODES } from '../../constants/http.ts';
import { MIME_TYPES } from '../../constants/request.ts';
import type { HonoEnvironment } from '../../context.ts';
import { expectErrorResponse, expectValidationIssueForField } from '../../tests/auth.ts';
import { integrationTest } from '../../tests/fixtures.ts';
import { createTestUser } from '../../tests/utils.ts';
import { CREATE_CARD_ROUTE_PATH } from '../handlers/create-card.ts';
import { UPDATE_CARD_ROUTE_PATH } from '../handlers/update-card.ts';
import { CardSchema } from '../schemas/responses.ts';

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

const UPDATE_PAYLOAD = {
  game: 'one_piece',
  name: 'Roronoa Zoro',
  set_name: 'Romance Dawn',
  card_number: 'OP01-025',
  notes: 'Alt art',
  quantities: [{ condition: 'mint', quantity: 1 }],
};

describe('Update card integration', () => {
  integrationTest('returns a not-found error without an authenticated session', async ({ app }) => {
    const response = await sendUpdateCardRequest(app, 'some-card-id', UPDATE_PAYLOAD);

    const body = await expectErrorResponse(response, STATUS_CODES.NOT_FOUND);

    expect(body).toEqual({ message: 'Not found', code: 'NOT_FOUND' });
  });

  integrationTest('returns a card-not-found error for an unknown card id', async ({ app, db }) => {
    const { sessionToken } = await createTestUser(app, db);

    const response = await sendUpdateCardRequest(
      app,
      crypto.randomUUID(),
      UPDATE_PAYLOAD,
      sessionHeaders(sessionToken),
    );

    const body = await expectErrorResponse(response, STATUS_CODES.NOT_FOUND);
    expect(body).toEqual({ message: 'Card not found', code: 'CARD_NOT_FOUND' });
  });

  integrationTest("returns a card-not-found error for another user's card", async ({ app, db }) => {
    const userA = await createTestUser(app, db);
    const userB = await createTestUser(app, db);
    const createdCard = await createCard(app, userA.sessionToken, CREATE_PAYLOAD);

    const response = await sendUpdateCardRequest(
      app,
      createdCard.id,
      UPDATE_PAYLOAD,
      sessionHeaders(userB.sessionToken),
    );

    const body = await expectErrorResponse(response, STATUS_CODES.NOT_FOUND);
    expect(body).toEqual({ message: 'Card not found', code: 'CARD_NOT_FOUND' });
    const persistedCard = await db.query.card.findFirst({
      where: { id: createdCard.id },
      with: { quantities: true },
    });
    expect(persistedCard).toMatchObject({
      userId: userA.userId,
      name: 'Monkey D. Luffy',
      cardNumber: 'OP01-003',
      notes: null,
    });
    expect(persistedCard?.quantities).toHaveLength(2);
  });

  integrationTest('returns a validation error for an empty name', async ({ app, db }) => {
    const { sessionToken } = await createTestUser(app, db);
    const createdCard = await createCard(app, sessionToken, CREATE_PAYLOAD);

    const response = await sendUpdateCardRequest(
      app,
      createdCard.id,
      { ...UPDATE_PAYLOAD, name: '' },
      sessionHeaders(sessionToken),
    );

    await expectValidationIssueForField(response, 'name');
  });

  integrationTest('returns a validation error for empty quantities', async ({ app, db }) => {
    const { sessionToken } = await createTestUser(app, db);
    const createdCard = await createCard(app, sessionToken, CREATE_PAYLOAD);

    const response = await sendUpdateCardRequest(
      app,
      createdCard.id,
      { ...UPDATE_PAYLOAD, quantities: [] },
      sessionHeaders(sessionToken),
    );

    await expectValidationIssueForField(response, 'quantities');
  });

  integrationTest(
    'fully replaces the card scalars and quantities',
    async ({ app, db, getLogsForRequestId, withRequestId }) => {
      const createdUser = await createTestUser(app, db);
      const createdCard = await createCard(app, createdUser.sessionToken, CREATE_PAYLOAD);
      const { headers, requestId } = withRequestId(sessionHeaders(createdUser.sessionToken));

      const response = await sendUpdateCardRequest(app, createdCard.id, UPDATE_PAYLOAD, headers);

      expect(response.status).toBe(STATUS_CODES.OK);
      const body = CardSchema.parse(await response.json());
      expect(body).toMatchObject({
        id: createdCard.id,
        game: 'one_piece',
        name: 'Roronoa Zoro',
        set_name: 'Romance Dawn',
        card_number: 'OP01-025',
        notes: 'Alt art',
        quantities: [{ condition: 'mint', quantity: 1 }],
      });

      const persistedCard = await db.query.card.findFirst({
        where: { id: createdCard.id },
        with: { quantities: true },
      });
      expect(persistedCard).toMatchObject({
        name: 'Roronoa Zoro',
        cardNumber: 'OP01-025',
        notes: 'Alt art',
      });
      expect(persistedCard?.quantities).toEqual([
        expect.objectContaining({ condition: 'mint', quantity: 1, cardId: createdCard.id }),
      ]);
      expect(persistedCard?.updatedAt.getTime()).toBeGreaterThan(new Date(createdCard.created_at).getTime());
      expect(getLogsForRequestId(requestId)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            event: 'cards.update',
            msg: 'Updated card entry successfully.',
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

async function sendUpdateCardRequest(
  app: Hono<HonoEnvironment>,
  cardId: string,
  payload: unknown,
  headers: HeadersInit = {},
) {
  const requestHeaders = new Headers(headers);
  requestHeaders.set('Content-Type', MIME_TYPES.JSON);

  return app.request(UPDATE_CARD_ROUTE_PATH.replace('{cardId}', cardId), {
    method: 'PUT',
    headers: requestHeaders,
    body: JSON.stringify(payload),
  });
}
