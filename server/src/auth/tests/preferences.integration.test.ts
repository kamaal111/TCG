import { expectValidationIssueForField } from '../../tests/auth.ts';
import { integrationTest } from '../../tests/fixtures.ts';
import { createTestUser } from '../../tests/utils.ts';
import { SESSION_ROUTE_PATH } from '../constants.ts';
import { SessionResponseSchema } from '../schemas/responses.ts';

integrationTest('persists preferred currency only for the authenticated account', async ({ app, db }) => {
  const first = await createTestUser(app, db);
  const second = await createTestUser(app, db);
  const headers = { Cookie: `better-auth.session_token=${first.sessionToken}`, 'Content-Type': 'application/json' };
  const initial = await app.request(SESSION_ROUTE_PATH, { headers });
  expect(SessionResponseSchema.parse(await initial.json()).user).toMatchObject({
    preferred_currency: 'USD',
    has_preferred_currency_preference: false,
  });

  const response = await app.request('/app-api/auth/preferences', {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ preferred_currency: 'EUR', user_id: second.userId }),
  });

  expect(response.status).toBe(200);
  expect(SessionResponseSchema.parse(await response.json()).user).toMatchObject({
    id: first.userId,
    preferred_currency: 'EUR',
    has_preferred_currency_preference: true,
  });
  const reloaded = await app.request(SESSION_ROUTE_PATH, { headers });
  expect(SessionResponseSchema.parse(await reloaded.json()).user.preferred_currency).toBe('EUR');

  const other = await app.request(SESSION_ROUTE_PATH, {
    headers: { Cookie: `better-auth.session_token=${second.sessionToken}` },
  });

  expect(SessionResponseSchema.parse(await other.json()).user.has_preferred_currency_preference).toBe(false);
});

integrationTest('rejects unsupported preferences and unauthenticated writes', async ({ app, db }) => {
  const user = await createTestUser(app, db);
  const headers = { Cookie: `better-auth.session_token=${user.sessionToken}`, 'Content-Type': 'application/json' };

  const invalid = await app.request('/app-api/auth/preferences', {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ preferred_currency: 'XYZ' }),
  });

  await expectValidationIssueForField(invalid, 'preferred_currency');

  const missing = await app.request('/app-api/auth/preferences', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ preferred_currency: 'EUR' }),
  });

  expect(missing.status).toBe(401);
});

integrationTest('region seeding cannot overwrite an explicit preference from another device', async ({ app, db }) => {
  const user = await createTestUser(app, db);
  const headers = { Cookie: `better-auth.session_token=${user.sessionToken}`, 'Content-Type': 'application/json' };

  const chosen = await app.request('/app-api/auth/preferences', {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ preferred_currency: 'GBP' }),
  });

  expect(chosen.status).toBe(200);

  const seed = await app.request('/app-api/auth/preferences', {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ preferred_currency: 'EUR', only_if_unset: true }),
  });

  expect(seed.status).toBe(200);
  expect(SessionResponseSchema.parse(await seed.json()).user).toMatchObject({
    preferred_currency: 'GBP',
    has_preferred_currency_preference: true,
  });
});
