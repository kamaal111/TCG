import assert from 'node:assert/strict';

import { CONTENTFUL_STATUS_CODES } from '@tcg/http/status';
import { eq } from 'drizzle-orm';

import type { createCardRequest } from './utils.ts';
import { validCardPayload, createTestCard, ownershipPayload } from './utils.ts';
import { card, cardConditionQuantity } from '../../db/schema/cards.ts';
import { expectErrorResponse, sessionHeaders } from '../../tests/auth.ts';
import { integrationTest } from '../../tests/fixtures.ts';
import { CardSchema, CardWithPriceSchema } from '../schemas/responses.ts';

describe('Update card integration', () => {
  integrationTest('requires a session and hides missing cards', async ({ app, user }) => {
    const response = await app.request('/app-api/cards/missing', { method: 'PUT' });
    expect(await expectErrorResponse(response, CONTENTFUL_STATUS_CODES.UNAUTHORIZED)).toMatchObject({
      code: 'SESSION_NOT_FOUND',
    });

    const missing = await updateRequest(
      app,
      user.sessionToken,
      '00000000-0000-0000-0000-000000000000',
      ownershipPayload(validCardPayload),
    );

    expect(await expectErrorResponse(missing, CONTENTFUL_STATUS_CODES.NOT_FOUND)).toMatchObject({
      code: 'CARD_NOT_FOUND',
    });
  });

  integrationTest(
    "does not update another user's card and logs the access denial",
    async ({ app, db, getLogsForRequestId, withRequestId, user: owner, createUser }) => {
      const otherUser = await createUser();
      const original = await createTestCard(app, owner.sessionToken, validCardPayload);

      const { headers, requestId } = withRequestId(sessionHeaders(otherUser.sessionToken));

      const response = await app.request(`/app-api/cards/${original.id}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ ...ownershipPayload(validCardPayload), notes: 'Stolen' }),
      });

      expect(await expectErrorResponse(response, CONTENTFUL_STATUS_CODES.NOT_FOUND)).toMatchObject({
        code: 'CARD_NOT_FOUND',
      });
      expect(await db.query.card.findFirst({ where: { id: original.id } })).toMatchObject({ name: original.name });
      expect(getLogsForRequestId(requestId)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ event: 'cards.access_denied', card_id: original.id, user_id: otherUser.userId }),
        ]),
      );
    },
  );

  integrationTest(
    'rejects every catalog identity field without writing ownership changes',
    async ({ app, db, user }) => {
      const original = await createTestCard(app, user.sessionToken, validCardPayload);

      for (const [key, value] of Object.entries({
        game: 'pokemon',
        name: 'Pikachu',
        set_name: 'Base Set',
        card_number: '58/102',
        illustrator: 'Mitsuhiro Arita',
        priced_card_id: '550e8400-e29b-41d4-a716-446655440000',
      })) {
        const response = await updateRequest(app, user.sessionToken, original.id, {
          ...ownershipPayload(validCardPayload),
          [key]: value,
          notes: 'Rejected',
        });

        expect(await expectErrorResponse(response, CONTENTFUL_STATUS_CODES.BAD_REQUEST)).toMatchObject({
          code: 'INVALID_PAYLOAD',
        });
      }

      expect(await db.query.card.findFirst({ where: { id: original.id } })).toMatchObject({
        name: original.name,
        notes: null,
      });
    },
  );

  integrationTest('clears notes when the replacement payload omits them', async ({ app, db, user }) => {
    const original = await createTestCard(app, user.sessionToken, { ...validCardPayload, notes: 'Alternate art' });

    expect(original.notes).toBe('Alternate art');

    const response = await updateRequest(app, user.sessionToken, original.id, ownershipPayload(validCardPayload));
    const body = CardSchema.parse(await response.json());

    expect(body.notes).toBeNull();
    expect(await db.query.card.findFirst({ where: { id: original.id } })).toMatchObject({ notes: null });
  });

  integrationTest('trims replacement notes and clears whitespace-only notes', async ({ app, db, user }) => {
    const original = await createTestCard(app, user.sessionToken, validCardPayload);

    const padded = CardSchema.parse(
      await (
        await updateRequest(app, user.sessionToken, original.id, {
          ...ownershipPayload(validCardPayload),
          notes: '  Foil  ',
        })
      ).json(),
    );

    expect(padded.notes).toBe('Foil');

    const blanked = CardSchema.parse(
      await (
        await updateRequest(app, user.sessionToken, original.id, {
          ...ownershipPayload(validCardPayload),
          notes: '   ',
        })
      ).json(),
    );

    expect(blanked.notes).toBeNull();
    expect(await db.query.card.findFirst({ where: { id: original.id } })).toMatchObject({ notes: null });
  });

  integrationTest(
    'replaces ownership details and logs success',
    async ({ app, db, getLogsForRequestId, withRequestId, user, authenticatedHeaders }) => {
      const original = await createTestCard(app, user.sessionToken, validCardPayload);
      const { headers, requestId } = withRequestId(authenticatedHeaders);

      const replacement = {
        ...ownershipPayload(validCardPayload),
        notes: 'First edition',
        purchases: [{ condition: 'mint' as const, quantity: 1, purchase_price: '1.00', currency: 'USD' as const }],
      };

      const response = await app.request(`/app-api/cards/${original.id}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify(replacement),
      });

      const body = CardSchema.parse(await response.json());

      const quantities = await db
        .select()
        .from(cardConditionQuantity)
        .where(eq(cardConditionQuantity.cardId, original.id));

      expect(body).toMatchObject({
        ...replacement,
        purchases: [
          expect.objectContaining({ condition: 'mint', quantity: 1, purchase_price: '1.000000', currency: 'USD' }),
        ],
      });
      expect(quantities).toHaveLength(1);
      expect(quantities[0]).toMatchObject({ condition: 'mint', quantity: 1 });
      expect(new Date(body.updated_at).getTime()).toBeGreaterThanOrEqual(new Date(original.updated_at).getTime());
      expect(getLogsForRequestId(requestId)).toEqual(
        expect.arrayContaining([expect.objectContaining({ event: 'cards.update', card_id: original.id })]),
      );
    },
  );
  integrationTest('updates ownership on an unmatched legacy card', async ({ app, db, user }) => {
    const [legacy] = await db
      .insert(card)
      .values({
        userId: user.userId,
        game: 'pokemon',
        name: 'no',
        setName: 'Unknown',
        cardNumber: 'results',
      })
      .returning();

    assert(legacy != null);

    const response = await updateRequest(app, user.sessionToken, legacy.id, {
      ...ownershipPayload(validCardPayload),
      notes: 'Legacy note',
    });

    expect(response.status).toBe(200);
    expect(CardWithPriceSchema.parse(await response.json())).toMatchObject({
      name: legacy.name,
      set_name: legacy.setName,
      card_number: legacy.cardNumber,
      notes: 'Legacy note',
      price: { status: 'no_match' },
    });
    expect(await db.query.card.findFirst({ where: { id: legacy.id } })).toMatchObject({
      name: legacy.name,
      pricingCardId: null,
      notes: 'Legacy note',
    });
  });
});

function updateRequest(
  app: Parameters<typeof createCardRequest>[0],
  sessionToken: string,
  cardId: string,
  payload: ReturnType<typeof ownershipPayload>,
) {
  return app.request(`/app-api/cards/${cardId}`, {
    method: 'PUT',
    headers: sessionHeaders(sessionToken),
    body: JSON.stringify(payload),
  });
}
