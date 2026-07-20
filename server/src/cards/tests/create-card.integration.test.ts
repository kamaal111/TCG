import { eq } from 'drizzle-orm';

import { STATUS_CODES } from '../../constants/http.ts';
import { cardConditionQuantity } from '../../db/schema/cards.ts';
import { expectErrorResponse, expectValidationIssueForField } from '../../tests/auth.ts';
import { integrationTest } from '../../tests/fixtures.ts';
import { createTestUser } from '../../tests/utils.ts';
import { CREATE_CARD_ROUTE_PATH } from '../handlers/create-card.ts';
import { CardSchema } from '../schemas/responses.ts';
import { createCardRequest, sessionHeaders, validCardPayload } from './utils.ts';

describe('Create card integration', () => {
  integrationTest('requires an authenticated session', async ({ app }) => {
    const response = await app.request(CREATE_CARD_ROUTE_PATH, { method: 'POST' });
    expect(await expectErrorResponse(response, STATUS_CODES.NOT_FOUND)).toMatchObject({
      code: 'SESSION_NOT_FOUND',
    });
  });

  integrationTest('rejects invalid card fields and quantities', async ({ app, db }) => {
    const user = await createTestUser(app, db);
    const cases: [string, unknown][] = [
      ['name', { ...validCardPayload, name: '' }],
      ['set_name', { ...validCardPayload, set_name: '' }],
      ['card_number', { ...validCardPayload, card_number: '' }],
      ['game', { ...validCardPayload, game: 'digimon' }],
      ['quantities', { ...validCardPayload, quantities: [] }],
      ['quantity', { ...validCardPayload, quantities: [{ condition: 'mint', quantity: 0 }] }],
      ['quantity', { ...validCardPayload, quantities: [{ condition: 'mint', quantity: 1.5 }] }],
      ['condition', { ...validCardPayload, quantities: [{ condition: 'pristine', quantity: 1 }] }],
      [
        'quantities',
        {
          ...validCardPayload,
          quantities: [
            { condition: 'mint', quantity: 1 },
            { condition: 'mint', quantity: 2 },
          ],
        },
      ],
      ['name', { ...validCardPayload, name: 'a'.repeat(201) }],
    ];

    for (const [field, payload] of cases) {
      const response = await app.request(CREATE_CARD_ROUTE_PATH, {
        method: 'POST',
        headers: sessionHeaders(user.sessionToken),
        body: JSON.stringify(payload),
      });
      await expectValidationIssueForField(response, field);
    }
  });

  integrationTest('creates and persists a card with deterministic quantities', async ({ app, db }) => {
    const user = await createTestUser(app, db);
    const response = await createCardRequest(app, user.sessionToken);

    expect(response.status).toBe(STATUS_CODES.CREATED);
    const body = CardSchema.parse(await response.json());
    expect(body).toMatchObject({ ...validCardPayload, notes: null });

    const persisted = await db.query.card.findFirst({ where: { id: body.id } });
    const quantities = await db.select().from(cardConditionQuantity).where(eq(cardConditionQuantity.cardId, body.id));
    expect(persisted).toMatchObject({ userId: user.userId, name: validCardPayload.name });
    expect(quantities).toEqual(
      expect.arrayContaining(validCardPayload.quantities.map(quantity => expect.objectContaining(quantity))),
    );
  });

  integrationTest('trims notes and treats whitespace-only notes as unset', async ({ app, db }) => {
    const user = await createTestUser(app, db);

    const padded = await createCardRequest(app, user.sessionToken, { ...validCardPayload, notes: '  Foil  ' });
    expect(CardSchema.parse(await padded.json()).notes).toBe('Foil');

    const blank = await createCardRequest(app, user.sessionToken, { ...validCardPayload, notes: '   ' });
    expect(CardSchema.parse(await blank.json()).notes).toBeNull();
  });

  integrationTest(
    'round-trips notes and multiple conditions and logs success',
    async ({ app, db, getLogsForRequestId, withRequestId }) => {
      const user = await createTestUser(app, db);
      const { headers, requestId } = withRequestId(Object.fromEntries(sessionHeaders(user.sessionToken).entries()));
      const response = await app.request(CREATE_CARD_ROUTE_PATH, {
        method: 'POST',
        headers,
        body: JSON.stringify({ ...validCardPayload, notes: 'Alternate art' }),
      });
      const body = CardSchema.parse(await response.json());

      expect(body.notes).toBe('Alternate art');
      expect(body.quantities).toEqual(validCardPayload.quantities);
      expect(getLogsForRequestId(requestId)).toEqual(
        expect.arrayContaining([expect.objectContaining({ event: 'cards.create', card_id: body.id })]),
      );
    },
  );
});
