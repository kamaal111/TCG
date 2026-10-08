import { eq } from 'drizzle-orm';

import { createCardRequest, sessionHeaders, validCardPayload } from './utils.ts';
import { CONTENTFUL_STATUS_CODES } from '../../constants/http.ts';
import { cardConditionQuantity } from '../../db/schema/cards.ts';
import { expectErrorResponse, expectValidationIssueForField } from '../../tests/auth.ts';
import { integrationTest } from '../../tests/fixtures.ts';
import { createTestUser } from '../../tests/utils.ts';
import { CREATE_CARD_ROUTE_PATH } from '../routes/create-card.ts';
import { CardSchema } from '../schemas/responses.ts';

describe('Create card integration', () => {
  integrationTest('requires an authenticated session', async ({ app }) => {
    const response = await app.request(CREATE_CARD_ROUTE_PATH, { method: 'POST' });
    expect(await expectErrorResponse(response, CONTENTFUL_STATUS_CODES.UNAUTHORIZED)).toMatchObject({
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
      ['purchases', { ...validCardPayload, purchases: [] }],
      [
        'quantity',
        { ...validCardPayload, purchases: [{ condition: 'mint', quantity: 0, purchase_price: null, currency: null }] },
      ],
      [
        'quantity',
        {
          ...validCardPayload,
          purchases: [{ condition: 'mint', quantity: 1.5, purchase_price: null, currency: null }],
        },
      ],
      [
        'condition',
        {
          ...validCardPayload,
          purchases: [{ condition: 'pristine', quantity: 1, purchase_price: null, currency: null }],
        },
      ],
      [
        'purchases',
        {
          ...validCardPayload,
          purchases: [
            { condition: 'mint', quantity: 999, purchase_price: null, currency: null },
            { condition: 'mint', quantity: 2, purchase_price: null, currency: null },
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

    expect(response.status).toBe(CONTENTFUL_STATUS_CODES.CREATED);
    const body = CardSchema.parse(await response.json());
    expect(body).toMatchObject({ name: validCardPayload.name, notes: null });

    const persisted = await db.query.card.findFirst({ where: { id: body.id } });
    const quantities = await db.select().from(cardConditionQuantity).where(eq(cardConditionQuantity.cardId, body.id));
    expect(persisted).toMatchObject({ userId: user.userId, name: validCardPayload.name });
    expect(quantities).toEqual(
      expect.arrayContaining(
        validCardPayload.purchases.map(({ condition, quantity }) => expect.objectContaining({ condition, quantity })),
      ),
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
      expect(body.purchases.map(({ condition, quantity }) => ({ condition, quantity }))).toEqual(
        expect.arrayContaining(validCardPayload.purchases.map(({ condition, quantity }) => ({ condition, quantity }))),
      );
      expect(getLogsForRequestId(requestId)).toEqual(
        expect.arrayContaining([expect.objectContaining({ event: 'cards.create', card_id: body.id })]),
      );
    },
  );
});
