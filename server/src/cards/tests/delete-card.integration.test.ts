import { eq } from 'drizzle-orm';

import { STATUS_CODES } from '../../constants/http.ts';
import { cardConditionQuantity } from '../../db/schema/cards.ts';
import { expectErrorResponse } from '../../tests/auth.ts';
import { integrationTest } from '../../tests/fixtures.ts';
import { createTestUser } from '../../tests/utils.ts';
import { CardSchema } from '../schemas/responses.ts';
import { createCardRequest, sessionHeaders, validCardPayload } from './utils.ts';

describe('Delete card integration', () => {
  integrationTest('requires a session and hides missing cards', async ({ app, db }) => {
    const unauthenticated = await app.request('/app-api/cards/missing', { method: 'DELETE' });
    expect(await expectErrorResponse(unauthenticated, STATUS_CODES.NOT_FOUND)).toMatchObject({
      code: 'SESSION_NOT_FOUND',
    });
    const user = await createTestUser(app, db);
    const missing = await app.request('/app-api/cards/00000000-0000-0000-0000-000000000000', {
      method: 'DELETE',
      headers: sessionHeaders(user.sessionToken),
    });
    expect(await expectErrorResponse(missing, STATUS_CODES.NOT_FOUND)).toMatchObject({ code: 'CARD_NOT_FOUND' });
  });

  integrationTest("does not delete another user's card", async ({ app, db }) => {
    const owner = await createTestUser(app, db);
    const otherUser = await createTestUser(app, db);
    const card = CardSchema.parse(await (await createCardRequest(app, owner.sessionToken)).json());
    const response = await app.request(`/app-api/cards/${card.id}`, {
      method: 'DELETE',
      headers: sessionHeaders(otherUser.sessionToken),
    });
    expect(await expectErrorResponse(response, STATUS_CODES.NOT_FOUND)).toMatchObject({ code: 'CARD_NOT_FOUND' });
    expect(await db.query.card.findFirst({ where: { id: card.id } })).toBeDefined();
  });

  integrationTest(
    'deletes the card, cascades quantities, and preserves other cards',
    async ({ app, db, getLogsForRequestId, withRequestId }) => {
      const user = await createTestUser(app, db);
      const target = CardSchema.parse(await (await createCardRequest(app, user.sessionToken)).json());
      const preserved = CardSchema.parse(
        await (await createCardRequest(app, user.sessionToken, { ...validCardPayload, name: 'Preserved' })).json(),
      );
      const { headers, requestId } = withRequestId(Object.fromEntries(sessionHeaders(user.sessionToken).entries()));
      const response = await app.request(`/app-api/cards/${target.id}`, { method: 'DELETE', headers });

      expect(response.status).toBe(STATUS_CODES.OK);
      expect(await response.json()).toEqual({});
      expect(await db.query.card.findFirst({ where: { id: target.id } })).toBeUndefined();
      expect(await db.select().from(cardConditionQuantity).where(eq(cardConditionQuantity.cardId, target.id))).toEqual(
        [],
      );
      expect(await db.query.card.findFirst({ where: { id: preserved.id } })).toBeDefined();
      expect(getLogsForRequestId(requestId)).toEqual(
        expect.arrayContaining([expect.objectContaining({ event: 'cards.delete', card_id: target.id })]),
      );
    },
  );
});
