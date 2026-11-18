import { requestOwnedPrices, createTestCard, validCardPayload } from './utils.ts';
import { expectErrorResponse } from '../../tests/auth.ts';
import { integrationTest } from '../../tests/fixtures.ts';
import { OwnedCardPricesSchema } from '../schemas/responses.ts';

integrationTest(
  'prices the owned ID only and hides foreign card details',
  async ({ app, user, createUser, authenticatedHeaders }) => {
    const other = await createUser();
    const own = await createTestCard(app, user.sessionToken, validCardPayload);
    const foreign = await createTestCard(app, other.sessionToken, validCardPayload);
    const ids = [own.id, foreign.id, crypto.randomUUID()];
    const priced = await requestOwnedPrices(app, authenticatedHeaders, ids);

    expect(priced.status).toBe(200);
    expect(OwnedCardPricesSchema.parse(await priced.json()).prices.map(entry => entry.id)).toEqual([own.id]);

    const detail = await app.request(`/app-api/cards/${foreign.id}`, { headers: authenticatedHeaders });
    expect(await expectErrorResponse(detail, 404)).toMatchObject({ code: 'CARD_NOT_FOUND' });

    const list = await app.request(`/app-api/cards?collection_id=${crypto.randomUUID()}`, {
      headers: authenticatedHeaders,
    });

    expect(await expectErrorResponse(list, 404)).toMatchObject({ code: 'COLLECTION_NOT_FOUND' });
  },
);

for (const [name, ids] of [
  ['empty', []],
  ['invalid ID', ['no']],
  ['duplicate ID', ['00000000-0000-4000-8000-000000000010', '00000000-0000-4000-8000-000000000010']],
  ['101 IDs', Array.from({ length: 101 }, () => crypto.randomUUID())],
] as const) {
  integrationTest(`rejects a pricing request with ${name}`, async ({ app, authenticatedHeaders }) => {
    const response = await requestOwnedPrices(app, authenticatedHeaders, ids);
    expect(await expectErrorResponse(response, 400)).toMatchObject({ code: 'INVALID_PAYLOAD' });
  });
}

integrationTest('the price endpoint requires a session', async ({ app }) => {
  const response = await requestOwnedPrices(app, { 'Content-Type': 'application/json' }, [crypto.randomUUID()]);
  expect(await expectErrorResponse(response, 401)).toMatchObject({ code: 'SESSION_NOT_FOUND' });
});
