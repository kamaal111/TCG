import { inArray } from 'drizzle-orm';

import { createTestCard } from './utils.ts';
import { cardConditionQuantity, cardPurchaseBatch } from '../../db/schema/cards.ts';
import { expectErrorResponse, expectValidationIssueForField } from '../../tests/auth.ts';
import { integrationTest } from '../../tests/fixtures.ts';

const path = '/app-api/cards';

const missingId = '550e8400-e29b-41d4-a716-446655440003';

describe('Delete cards integration', () => {
  integrationTest(
    'deletes owned cards with cascades, preserves other cards, and logs counts',
    async ({ app, db, withRequestId, getLogsForRequestId, user, authenticatedHeaders }) => {
      const first = await createTestCard(app, user.sessionToken);
      const second = await createTestCard(app, user.sessionToken);
      const preserved = await createTestCard(app, user.sessionToken);
      const ids = [second.id, first.id];
      const { headers, requestId } = withRequestId(authenticatedHeaders);
      const response = await app.request(path, { method: 'DELETE', headers, body: JSON.stringify({ card_ids: ids }) });

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ deleted_ids: ids, not_found_ids: [] });
      expect(await db.query.card.findFirst({ where: { id: first.id } })).toBeUndefined();
      expect(await db.query.card.findFirst({ where: { id: second.id } })).toBeUndefined();
      expect(await db.query.card.findFirst({ where: { id: preserved.id } })).toBeDefined();
      expect(await db.select().from(cardConditionQuantity).where(inArray(cardConditionQuantity.cardId, ids))).toEqual(
        [],
      );
      expect(await db.select().from(cardPurchaseBatch).where(inArray(cardPurchaseBatch.cardId, ids))).toEqual([]);
      expect(getLogsForRequestId(requestId)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            event: 'cards.delete',
            result_count: 2,
            not_found_count: 0,
            user_id: user.userId,
          }),
        ]),
      );
    },
  );

  integrationTest(
    'deduplicates IDs, hides ownership, preserves foreign cards, and safely retries',
    async ({ app, db, user, createUser, authenticatedHeaders }) => {
      const other = await createUser();
      const owned = await createTestCard(app, user.sessionToken);
      const foreign = await createTestCard(app, other.sessionToken);

      const request = {
        method: 'DELETE',
        headers: authenticatedHeaders,
        body: JSON.stringify({ card_ids: [owned.id, foreign.id, missingId, owned.id] }),
      };

      const response = await app.request(path, request);

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ deleted_ids: [owned.id], not_found_ids: [foreign.id, missingId] });
      expect(await db.query.card.findFirst({ where: { id: foreign.id } })).toBeDefined();
      const retry = await app.request(path, request);
      expect(retry.status).toBe(200);
      expect(await retry.json()).toEqual({ deleted_ids: [], not_found_ids: [owned.id, foreign.id, missingId] });
    },
  );

  integrationTest(
    'deletes one ID through the shared endpoint and reports missing single IDs',
    async ({ app, db, user, authenticatedHeaders }) => {
      const owned = await createTestCard(app, user.sessionToken);

      const deleted = await app.request(path, {
        method: 'DELETE',
        headers: authenticatedHeaders,
        body: JSON.stringify({ card_ids: [owned.id] }),
      });

      expect(deleted.status).toBe(200);
      expect(await deleted.json()).toEqual({ deleted_ids: [owned.id], not_found_ids: [] });
      expect(await db.query.card.findFirst({ where: { id: owned.id } })).toBeUndefined();

      const missing = await app.request(path, {
        method: 'DELETE',
        headers: authenticatedHeaders,
        body: JSON.stringify({ card_ids: [owned.id] }),
      });

      expect(missing.status).toBe(200);
      expect(await missing.json()).toEqual({ deleted_ids: [], not_found_ids: [owned.id] });
    },
  );

  integrationTest('removes both previous deletion paths', async ({ app, db, user, authenticatedHeaders }) => {
    const owned = await createTestCard(app, user.sessionToken);

    const previousSingle = await app.request(`/app-api/cards/${owned.id}`, {
      method: 'DELETE',
      headers: authenticatedHeaders,
    });

    const previousBulk = await app.request('/app-api/cards/bulk-delete', {
      method: 'POST',
      headers: authenticatedHeaders,
      body: JSON.stringify({ card_ids: [owned.id] }),
    });

    expect(previousSingle.status).toBe(404);
    expect(previousBulk.status).toBe(404);
    expect(await db.query.card.findFirst({ where: { id: owned.id } })).toBeDefined();
  });

  integrationTest('accepts empty selections', async ({ app, authenticatedHeaders }) => {
    const response = await app.request(path, {
      method: 'DELETE',
      headers: authenticatedHeaders,
      body: JSON.stringify({ card_ids: [] }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ deleted_ids: [], not_found_ids: [] });
  });

  integrationTest('requires a session before deleting any cards', async ({ app, db, user }) => {
    const owned = await createTestCard(app, user.sessionToken);

    const response = await app.request(path, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ card_ids: [owned.id] }),
    });

    expect(await expectErrorResponse(response, 401)).toMatchObject({ code: 'SESSION_NOT_FOUND' });
    expect(await db.query.card.findFirst({ where: { id: owned.id } })).toBeDefined();
  });

  integrationTest.for([{}, { card_ids: 'invalid' }, { card_ids: ['invalid'] }])(
    'rejects invalid payloads without mutation: %j',
    async (payload, { app, authenticatedHeaders }) => {
      const response = await app.request(path, {
        method: 'DELETE',
        headers: authenticatedHeaders,
        body: JSON.stringify(payload),
      });

      await expectValidationIssueForField(response, 'card_ids');
    },
  );

  integrationTest('validates the entire batch before mutation', async ({ app, db, user, authenticatedHeaders }) => {
    const owned = await createTestCard(app, user.sessionToken);

    const response = await app.request(path, {
      method: 'DELETE',
      headers: authenticatedHeaders,
      body: JSON.stringify({ card_ids: [owned.id, 'invalid'] }),
    });

    await expectValidationIssueForField(response, 'card_ids');
    expect(await db.query.card.findFirst({ where: { id: owned.id } })).toBeDefined();
  });
});
