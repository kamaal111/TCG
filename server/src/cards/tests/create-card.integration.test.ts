import { CONTENTFUL_STATUS_CODES } from '@tcg/http/status';
import { eq } from 'drizzle-orm';

import { createCardRequest, ownershipPayload, postCard, seedCatalogPrinting, validCardPayload } from './utils.ts';
import { card, cardConditionQuantity } from '../../db/schema/cards.ts';
import { expectErrorResponse, expectValidationIssueForField } from '../../tests/auth.ts';
import { integrationTest } from '../../tests/fixtures.ts';
import { CREATE_CARD_ROUTE_PATH } from '../routes/create-card.ts';
import { CardSchema } from '../schemas/responses.ts';

describe('Create card integration', () => {
  integrationTest('requires an authenticated session', async ({ app }) => {
    const response = await app.request(CREATE_CARD_ROUTE_PATH, { method: 'POST' });
    expect(await expectErrorResponse(response, CONTENTFUL_STATUS_CODES.UNAUTHORIZED)).toMatchObject({
      code: 'SESSION_NOT_FOUND',
    });
  });

  integrationTest('rejects invalid card fields and quantities', async ({ app, authenticatedHeaders, db }) => {
    const printing = await seedCatalogPrinting(db, validCardPayload, 'scrydex_static');
    const valid = { ...ownershipPayload(validCardPayload), priced_card_id: printing.id };

    const cases: [string, unknown][] = [
      ['priced_card_id', { ...valid, priced_card_id: undefined }],
      ['priced_card_id', { ...valid, priced_card_id: 'invalid' }],
      ['purchases', { ...valid, purchases: [] }],
      ['quantity', { ...valid, purchases: [{ condition: 'mint', quantity: 0, purchase_price: null, currency: null }] }],
      [
        'quantity',
        {
          ...valid,
          purchases: [{ condition: 'mint', quantity: 1.5, purchase_price: null, currency: null }],
        },
      ],
      [
        'condition',
        {
          ...valid,
          purchases: [{ condition: 'pristine', quantity: 1, purchase_price: null, currency: null }],
        },
      ],
      [
        'purchases',
        {
          ...valid,
          purchases: [
            { condition: 'mint', quantity: 999, purchase_price: null, currency: null },
            { condition: 'mint', quantity: 2, purchase_price: null, currency: null },
          ],
        },
      ],
    ];

    for (const [field, payload] of cases) {
      const response = await app.request(CREATE_CARD_ROUTE_PATH, {
        method: 'POST',
        headers: authenticatedHeaders,
        body: JSON.stringify(payload),
      });

      await expectValidationIssueForField(response, field);
    }

    expect(await db.$count(card)).toBe(0);
  });

  integrationTest('explains how to recover from an unknown printing ID', async ({ app, authenticatedHeaders, db }) => {
    const response = await postCard(
      app,
      authenticatedHeaders,
      JSON.stringify({
        ...ownershipPayload(validCardPayload),
        priced_card_id: '550e8400-e29b-41d4-a716-446655440000',
      }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      code: 'INVALID_PAYLOAD',
      context: {
        validations: [
          {
            code: 'invalid_printing',
            path: ['priced_card_id'],
            message:
              'The printing ID could not be found in the catalog. Select the printing again from Search or Wishlist.',
          },
        ],
      },
    });
    expect(await db.$count(card)).toBe(0);
  });

  integrationTest('creates and persists a card with deterministic quantities', async ({ app, db, user }) => {
    const response = await createCardRequest(app, user.sessionToken, validCardPayload);

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

  integrationTest('trims notes and treats whitespace-only notes as unset', async ({ app, user }) => {
    const padded = await createCardRequest(app, user.sessionToken, { ...validCardPayload, notes: '  Foil  ' });
    expect(CardSchema.parse(await padded.json()).notes).toBe('Foil');

    const blank = await createCardRequest(app, user.sessionToken, { ...validCardPayload, notes: '   ' });
    expect(CardSchema.parse(await blank.json()).notes).toBeNull();
  });

  integrationTest(
    'round-trips notes and multiple conditions and logs success',
    async ({ app, db, getLogsForRequestId, withRequestId, authenticatedHeaders }) => {
      const { headers, requestId } = withRequestId(authenticatedHeaders);

      const selected = await seedCatalogPrinting(db, validCardPayload, 'scrydex_static');

      const response = await postCard(
        app,
        headers,
        JSON.stringify({
          ...ownershipPayload(validCardPayload),
          priced_card_id: selected.id,
          notes: 'Alternate art',
        }),
      );

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
