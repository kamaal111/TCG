import { expectAuthSuccessResponse, sessionHeaders } from './auth.ts';
import { integrationTest } from './fixtures.ts';
import { SIGN_IN_ROUTE_PATH, SESSION_ROUTE_PATH } from '../auth/constants.ts';
import { SessionResponseSchema } from '../auth/schemas/responses.ts';
import { SEARCH_PRICING_ROUTE_PATH } from '../card-pricing/routes/search-pricing.ts';
import { StaticScrydexClient } from '../card-pricing/scrydex/static-client.ts';

integrationTest('keeps account creation lazy until the user factory is called', async ({ app, db, createUser }) => {
  expect(await db.query.user.findMany()).toEqual([]);
  expect((await app.request(SESSION_ROUTE_PATH)).status).toBe(401);

  const created = await createUser();

  expect(await db.query.user.findMany()).toMatchObject([{ id: created.userId }]);
});

integrationTest(
  'shares one default account between user and headers and creates independent additional sessions',
  async ({ app, db, user, authenticatedHeaders, createUser }) => {
    expect(await db.query.user.findMany()).toMatchObject([{ id: user.userId }]);
    const response = await app.request(SESSION_ROUTE_PATH, { headers: authenticatedHeaders });
    expect(response.status).toBe(200);
    expect(SessionResponseSchema.parse(await response.json()).user.id).toBe(user.userId);

    const other = await createUser({ password: '12345678' });
    expect(other.userId).not.toBe(user.userId);
    expect(other.email).not.toBe(user.email);
    expect(other.sessionToken).not.toBe(user.sessionToken);
    expect(await db.query.user.findMany()).toHaveLength(2);

    const signedIn = await app.request(SIGN_IN_ROUTE_PATH, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: other.email, password: '12345678' }),
    });

    const authenticated = await expectAuthSuccessResponse(signedIn, 200);
    expect(authenticated.body.user.id).toBe(other.userId);

    const changed = sessionHeaders(user.sessionToken);
    changed.set('Cookie', `better-auth.session_token=${other.sessionToken}`);
    const fresh = await app.request(SESSION_ROUTE_PATH, { headers: sessionHeaders(user.sessionToken) });
    expect(fresh.status).toBe(200);
    expect(SessionResponseSchema.parse(await fresh.json()).user.id).toBe(user.userId);
    const original = await app.request(SESSION_ROUTE_PATH, { headers: authenticatedHeaders });
    expect(original.status).toBe(200);
    expect(SessionResponseSchema.parse(await original.json()).user.id).toBe(user.userId);
  },
);

integrationTest(
  'uses overridden pricing with the same persisted session across app instances',
  async ({ app, db, user, authenticatedHeaders, pricingClient, createApp }) => {
    const override = new StaticScrydexClient();
    const overriddenSearch = vi.spyOn(override, 'searchCards');
    const defaultSearch = vi.spyOn(pricingClient, 'searchCards');
    const alternate = createApp({ pricingClient: override });

    const response = await alternate.request(`${SEARCH_PRICING_ROUTE_PATH}?game=pokemon&query=Giratina`, {
      headers: authenticatedHeaders,
    });

    expect(response.status).toBe(200);
    expect(overriddenSearch).toHaveBeenCalledOnce();
    expect(defaultSearch).not.toHaveBeenCalled();
    expect(await db.query.cardPriceSearch.findMany()).toHaveLength(1);
    const session = await app.request(SESSION_ROUTE_PATH, { headers: authenticatedHeaders });
    expect(session.status).toBe(200);
    expect(SessionResponseSchema.parse(await session.json()).user.id).toBe(user.userId);
  },
);
