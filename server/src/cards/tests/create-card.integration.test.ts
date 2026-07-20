import type { Hono } from 'hono';

import { STATUS_CODES } from '../../constants/http.ts';
import { MIME_TYPES } from '../../constants/request.ts';
import type { HonoEnvironment } from '../../context.ts';
import { expectErrorResponse, expectValidationIssueForField } from '../../tests/auth.ts';
import { integrationTest } from '../../tests/fixtures.ts';
import { createTestUser } from '../../tests/utils.ts';
import { CREATE_CARD_ROUTE_PATH } from '../handlers/create-card.ts';
import { CardSchema } from '../schemas/responses.ts';

const VALID_PAYLOAD = {
  game: 'one_piece',
  name: 'Monkey D. Luffy',
  set_name: 'Romance Dawn',
  card_number: 'OP01-003',
  quantities: [{ condition: 'near_mint', quantity: 2 }],
};

describe('Create card integration', () => {
  integrationTest('returns a not-found error without an authenticated session', async ({ app }) => {
    const response = await sendCreateCardRequest(app, VALID_PAYLOAD);

    const body = await expectErrorResponse(response, STATUS_CODES.NOT_FOUND);

    expect(body).toEqual({ message: 'Not found', code: 'NOT_FOUND' });
  });

  integrationTest('returns a validation error for a missing name', async ({ app, db }) => {
    const { sessionToken } = await createTestUser(app, db);

    const { name: _name, ...payload } = VALID_PAYLOAD;
    const response = await sendCreateCardRequest(app, payload, sessionHeaders(sessionToken));

    await expectValidationIssueForField(response, 'name');
  });

  integrationTest('returns a validation error for an empty name', async ({ app, db }) => {
    const { sessionToken } = await createTestUser(app, db);

    const response = await sendCreateCardRequest(app, { ...VALID_PAYLOAD, name: '' }, sessionHeaders(sessionToken));

    await expectValidationIssueForField(response, 'name');
  });

  integrationTest('returns a validation error for an empty set name', async ({ app, db }) => {
    const { sessionToken } = await createTestUser(app, db);

    const response = await sendCreateCardRequest(app, { ...VALID_PAYLOAD, set_name: '' }, sessionHeaders(sessionToken));

    await expectValidationIssueForField(response, 'set_name');
  });

  integrationTest('returns a validation error for an empty card number', async ({ app, db }) => {
    const { sessionToken } = await createTestUser(app, db);

    const response = await sendCreateCardRequest(
      app,
      { ...VALID_PAYLOAD, card_number: '' },
      sessionHeaders(sessionToken),
    );

    await expectValidationIssueForField(response, 'card_number');
  });

  integrationTest('returns a validation error for an invalid game', async ({ app, db }) => {
    const { sessionToken } = await createTestUser(app, db);

    const response = await sendCreateCardRequest(
      app,
      { ...VALID_PAYLOAD, game: 'yu_gi_oh' },
      sessionHeaders(sessionToken),
    );

    await expectValidationIssueForField(response, 'game');
  });

  integrationTest('returns a validation error for empty quantities', async ({ app, db }) => {
    const { sessionToken } = await createTestUser(app, db);

    const response = await sendCreateCardRequest(
      app,
      { ...VALID_PAYLOAD, quantities: [] },
      sessionHeaders(sessionToken),
    );

    await expectValidationIssueForField(response, 'quantities');
  });

  integrationTest('returns a validation error for a zero quantity', async ({ app, db }) => {
    const { sessionToken } = await createTestUser(app, db);

    const response = await sendCreateCardRequest(
      app,
      { ...VALID_PAYLOAD, quantities: [{ condition: 'near_mint', quantity: 0 }] },
      sessionHeaders(sessionToken),
    );

    await expectValidationIssueForField(response, 'quantities');
  });

  integrationTest('returns a validation error for a non-integer quantity', async ({ app, db }) => {
    const { sessionToken } = await createTestUser(app, db);

    const response = await sendCreateCardRequest(
      app,
      { ...VALID_PAYLOAD, quantities: [{ condition: 'near_mint', quantity: 1.5 }] },
      sessionHeaders(sessionToken),
    );

    await expectValidationIssueForField(response, 'quantities');
  });

  integrationTest('returns a validation error for an invalid condition', async ({ app, db }) => {
    const { sessionToken } = await createTestUser(app, db);

    const response = await sendCreateCardRequest(
      app,
      { ...VALID_PAYLOAD, quantities: [{ condition: 'pristine', quantity: 1 }] },
      sessionHeaders(sessionToken),
    );

    await expectValidationIssueForField(response, 'quantities');
  });

  integrationTest('returns a validation error for duplicate conditions', async ({ app, db }) => {
    const { sessionToken } = await createTestUser(app, db);

    const response = await sendCreateCardRequest(
      app,
      {
        ...VALID_PAYLOAD,
        quantities: [
          { condition: 'near_mint', quantity: 1 },
          { condition: 'near_mint', quantity: 2 },
        ],
      },
      sessionHeaders(sessionToken),
    );

    await expectValidationIssueForField(response, 'quantities');
  });

  integrationTest('returns a validation error for an over-long name', async ({ app, db }) => {
    const { sessionToken } = await createTestUser(app, db);

    const response = await sendCreateCardRequest(
      app,
      { ...VALID_PAYLOAD, name: 'a'.repeat(201) },
      sessionHeaders(sessionToken),
    );

    await expectValidationIssueForField(response, 'name');
  });

  integrationTest('creates a card entry successfully', async ({ app, db, getLogsForRequestId, withRequestId }) => {
    const createdUser = await createTestUser(app, db);
    const { headers, requestId } = withRequestId(sessionHeaders(createdUser.sessionToken));

    const response = await sendCreateCardRequest(app, VALID_PAYLOAD, headers);

    expect(response.status).toBe(STATUS_CODES.CREATED);
    const body = CardSchema.parse(await response.json());
    expect(body).toMatchObject({
      game: 'one_piece',
      name: 'Monkey D. Luffy',
      set_name: 'Romance Dawn',
      card_number: 'OP01-003',
      notes: null,
      quantities: [{ condition: 'near_mint', quantity: 2 }],
    });

    const persistedCard = await db.query.card.findFirst({
      where: { id: body.id },
      with: { quantities: true },
    });
    expect(persistedCard).toMatchObject({
      userId: createdUser.userId,
      game: 'one_piece',
      name: 'Monkey D. Luffy',
      setName: 'Romance Dawn',
      cardNumber: 'OP01-003',
      notes: null,
    });
    expect(persistedCard?.quantities).toEqual([
      expect.objectContaining({ condition: 'near_mint', quantity: 2, cardId: body.id }),
    ]);
    expect(getLogsForRequestId(requestId)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: 'cards.create',
          msg: 'Created card entry successfully.',
          request_id: requestId,
          component: 'cards',
          outcome: 'success',
          user_id: createdUser.userId,
        }),
      ]),
    );
  });

  integrationTest('creates a card entry with notes and multiple conditions', async ({ app, db }) => {
    const { sessionToken } = await createTestUser(app, db);
    const payload = {
      game: 'pokemon',
      name: 'Pikachu',
      set_name: 'Base Set',
      card_number: '58/102',
      notes: 'First edition',
      quantities: [
        { condition: 'mint', quantity: 1 },
        { condition: 'played', quantity: 3 },
      ],
    };

    const response = await sendCreateCardRequest(app, payload, sessionHeaders(sessionToken));

    expect(response.status).toBe(STATUS_CODES.CREATED);
    const body = CardSchema.parse(await response.json());
    expect(body).toMatchObject({
      game: 'pokemon',
      name: 'Pikachu',
      set_name: 'Base Set',
      card_number: '58/102',
      notes: 'First edition',
      quantities: [
        { condition: 'mint', quantity: 1 },
        { condition: 'played', quantity: 3 },
      ],
    });
  });
});

function sessionHeaders(sessionToken: string): HeadersInit {
  return { Cookie: `better-auth.session_token=${sessionToken}` };
}

async function sendCreateCardRequest(app: Hono<HonoEnvironment>, payload: unknown, headers: HeadersInit = {}) {
  const requestHeaders = new Headers(headers);
  requestHeaders.set('Content-Type', MIME_TYPES.JSON);

  return app.request(CREATE_CARD_ROUTE_PATH, {
    method: 'POST',
    headers: requestHeaders,
    body: JSON.stringify(payload),
  });
}
