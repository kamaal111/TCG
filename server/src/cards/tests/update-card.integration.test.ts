import { eq } from 'drizzle-orm';

import { STATUS_CODES } from '../../constants/http.ts';
import { cardConditionQuantity } from '../../db/schema/cards.ts';
import { expectErrorResponse, expectValidationIssueForField } from '../../tests/auth.ts';
import { integrationTest } from '../../tests/fixtures.ts';
import { createTestUser } from '../../tests/utils.ts';
import { CardSchema } from '../schemas/responses.ts';
import { createCardRequest, sessionHeaders, validCardPayload } from './utils.ts';

describe('Update card integration', () => {
  integrationTest('requires a session and hides missing cards', async ({ app, db }) => {
    const response = await app.request('/app-api/cards/missing', { method: 'PUT' });
    expect(await expectErrorResponse(response, STATUS_CODES.NOT_FOUND)).toMatchObject({ code: 'SESSION_NOT_FOUND' });

    const user = await createTestUser(app, db);
    const missing = await updateRequest(
      app,
      user.sessionToken,
      '00000000-0000-0000-0000-000000000000',
      validCardPayload,
    );
    expect(await expectErrorResponse(missing, STATUS_CODES.NOT_FOUND)).toMatchObject({ code: 'CARD_NOT_FOUND' });
  });

  integrationTest("does not update another user's card", async ({ app, db }) => {
    const owner = await createTestUser(app, db);
    const otherUser = await createTestUser(app, db);
    const original = CardSchema.parse(await (await createCardRequest(app, owner.sessionToken)).json());
    const response = await updateRequest(app, otherUser.sessionToken, original.id, {
      ...validCardPayload,
      name: 'Stolen',
    });
    expect(await expectErrorResponse(response, STATUS_CODES.NOT_FOUND)).toMatchObject({ code: 'CARD_NOT_FOUND' });
    expect(await db.query.card.findFirst({ where: { id: original.id } })).toMatchObject({ name: original.name });
  });

  integrationTest('validates replacement input', async ({ app, db }) => {
    const user = await createTestUser(app, db);
    const card = CardSchema.parse(await (await createCardRequest(app, user.sessionToken)).json());
    const response = await updateRequest(app, user.sessionToken, card.id, { ...validCardPayload, name: '' });
    await expectValidationIssueForField(response, 'name');
  });

  integrationTest('clears notes when the replacement payload omits them', async ({ app, db }) => {
    const user = await createTestUser(app, db);
    const original = CardSchema.parse(
      await (await createCardRequest(app, user.sessionToken, { ...validCardPayload, notes: 'Alternate art' })).json(),
    );
    expect(original.notes).toBe('Alternate art');

    const response = await updateRequest(app, user.sessionToken, original.id, validCardPayload);
    const body = CardSchema.parse(await response.json());

    expect(body.notes).toBeNull();
    expect(await db.query.card.findFirst({ where: { id: original.id } })).toMatchObject({ notes: null });
  });

  integrationTest('trims replacement notes and clears whitespace-only notes', async ({ app, db }) => {
    const user = await createTestUser(app, db);
    const original = CardSchema.parse(await (await createCardRequest(app, user.sessionToken)).json());

    const padded = CardSchema.parse(
      await (
        await updateRequest(app, user.sessionToken, original.id, { ...validCardPayload, notes: '  Foil  ' })
      ).json(),
    );
    expect(padded.notes).toBe('Foil');

    const blanked = CardSchema.parse(
      await (await updateRequest(app, user.sessionToken, original.id, { ...validCardPayload, notes: '   ' })).json(),
    );
    expect(blanked.notes).toBeNull();
    expect(await db.query.card.findFirst({ where: { id: original.id } })).toMatchObject({ notes: null });
  });

  integrationTest(
    'fully replaces card fields and quantities and logs success',
    async ({ app, db, getLogsForRequestId, withRequestId }) => {
      const user = await createTestUser(app, db);
      const original = CardSchema.parse(await (await createCardRequest(app, user.sessionToken)).json());
      const { headers, requestId } = withRequestId(Object.fromEntries(sessionHeaders(user.sessionToken).entries()));
      const replacement = {
        ...validCardPayload,
        game: 'pokemon' as const,
        name: 'Pikachu',
        set_name: 'Base Set',
        card_number: '58/102',
        notes: 'First edition',
        quantities: [{ condition: 'mint' as const, quantity: 1 }],
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

      expect(body).toMatchObject(replacement);
      expect(quantities).toHaveLength(1);
      expect(quantities[0]).toMatchObject({ condition: 'mint', quantity: 1 });
      expect(new Date(body.updated_at).getTime()).toBeGreaterThanOrEqual(new Date(original.updated_at).getTime());
      expect(getLogsForRequestId(requestId)).toEqual(
        expect.arrayContaining([expect.objectContaining({ event: 'cards.update', card_id: original.id })]),
      );
    },
  );
});

function updateRequest(
  app: Parameters<typeof createCardRequest>[0],
  sessionToken: string,
  cardId: string,
  payload: typeof validCardPayload,
) {
  return app.request(`/app-api/cards/${cardId}`, {
    method: 'PUT',
    headers: sessionHeaders(sessionToken),
    body: JSON.stringify(payload),
  });
}
