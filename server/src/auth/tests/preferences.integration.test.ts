import { expectValidationIssueForField } from '../../tests/auth.ts';
import { integrationTest } from '../../tests/fixtures.ts';
import { SESSION_ROUTE_PATH } from '../constants.ts';
import { SessionResponseSchema } from '../schemas/responses.ts';

integrationTest(
  'logs resolved preferences with inherited request and account context',
  async ({ app, withRequestId, getLogsForRequestId, user, authenticatedHeaders: headers }) => {
    await app.request('/app-api/auth/preferences', {
      method: 'POST',
      headers,
      body: JSON.stringify({ preferred_currency: 'EUR' }),
    });
    const initialized = withRequestId(headers);

    const response = await app.request('/app-api/auth/preferences', {
      method: 'POST',
      headers: initialized.headers,
      body: JSON.stringify({ preferred_currency: 'JPY' }),
    });

    expect(response.status).toBe(200);
    const logs = getLogsForRequestId(initialized.requestId);
    expect(logs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: 'auth.preferences.completed',
          outcome: 'success',
          user_id: user.userId,
          preference_action: 'initialize',
          requested_currency: 'JPY',
          preferred_currency: 'EUR',
        }),
      ]),
    );
    expect(logs.filter(log => log.event === 'request.completed')).toHaveLength(1);
    expect(JSON.stringify(logs)).not.toContain(user.sessionToken);
    const updated = withRequestId(headers);
    expect(
      (
        await app.request('/app-api/auth/preferences', {
          method: 'PATCH',
          headers: updated.headers,
          body: JSON.stringify({ preferred_currency: 'GBP' }),
        })
      ).status,
    ).toBe(200);
    expect(getLogsForRequestId(updated.requestId)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: 'auth.preferences.completed',
          outcome: 'success',
          user_id: user.userId,
          preference_action: 'update',
          requested_currency: 'GBP',
          preferred_currency: 'GBP',
        }),
      ]),
    );
  },
);

integrationTest(
  'logs rejected preferences without a successful milestone',
  async ({ app, withRequestId, getLogsForRequestId }) => {
    const { headers, requestId } = withRequestId({ 'Content-Type': 'application/json' });

    const response = await app.request('/app-api/auth/preferences', {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ preferred_currency: 'EUR' }),
    });

    expect(response.status).toBe(401);
    const logs = getLogsForRequestId(requestId);
    expect(logs.filter(log => log.event === 'auth.preferences.completed')).toHaveLength(0);
    expect(logs.filter(log => log.event === 'request.error' && log.outcome === 'failure')).toHaveLength(1);
  },
);

integrationTest(
  'persists preferred currency only for the authenticated account',
  async ({ app, user: first, createUser, authenticatedHeaders: headers }) => {
    const second = await createUser();

    const initial = await app.request(SESSION_ROUTE_PATH, { headers });
    expect(SessionResponseSchema.parse(await initial.json()).user).toMatchObject({
      preferred_currency: 'USD',
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
    });
    const reloaded = await app.request(SESSION_ROUTE_PATH, { headers });
    expect(SessionResponseSchema.parse(await reloaded.json()).user.preferred_currency).toBe('EUR');

    const other = await app.request(SESSION_ROUTE_PATH, {
      headers: { Cookie: `better-auth.session_token=${second.sessionToken}` },
    });

    expect(SessionResponseSchema.parse(await other.json()).user.preferred_currency).toBe('USD');
  },
);

for (const method of ['POST', 'PATCH']) {
  integrationTest(
    `${method} rejects unsupported preferences and unauthenticated writes`,
    async ({ app, withRequestId, getLogsForRequestId, user, authenticatedHeaders: headers }) => {
      const validationRequest = withRequestId(headers);

      const invalid = await app.request('/app-api/auth/preferences', {
        method,
        headers: validationRequest.headers,
        body: JSON.stringify({ preferred_currency: 'XYZ' }),
      });

      await expectValidationIssueForField(invalid, 'preferred_currency');
      const validationLogs = getLogsForRequestId(validationRequest.requestId);
      expect(validationLogs).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            event: 'request.validation.failed',
            outcome: 'failure',
            user_id: user.userId,
          }),
        ]),
      );
      expect(validationLogs.filter(log => log.event === 'auth.preferences.completed')).toHaveLength(0);

      const missing = await app.request('/app-api/auth/preferences', {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preferred_currency: 'EUR' }),
      });

      expect(missing.status).toBe(401);
    },
  );
}

integrationTest(
  'region seeding cannot overwrite an explicit preference from another device',
  async ({ app, authenticatedHeaders: headers }) => {
    const chosen = await app.request('/app-api/auth/preferences', {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ preferred_currency: 'GBP' }),
    });

    expect(chosen.status).toBe(200);

    const seed = await app.request('/app-api/auth/preferences', {
      method: 'POST',
      headers,
      body: JSON.stringify({ preferred_currency: 'EUR' }),
    });

    expect(seed.status).toBe(200);
    expect(SessionResponseSchema.parse(await seed.json()).user).toMatchObject({
      preferred_currency: 'GBP',
    });
  },
);

integrationTest(
  'initializes a preference once and allows later explicit updates',
  async ({ app, authenticatedHeaders: headers }) => {
    const initialize = await app.request('/app-api/auth/preferences', {
      method: 'POST',
      headers,
      body: JSON.stringify({ preferred_currency: 'EUR' }),
    });

    expect(initialize.status).toBe(200);
    expect(SessionResponseSchema.parse(await initialize.json()).user).toMatchObject({
      preferred_currency: 'EUR',
    });

    const repeated = await app.request('/app-api/auth/preferences', {
      method: 'POST',
      headers,
      body: JSON.stringify({ preferred_currency: 'JPY' }),
    });

    expect(repeated.status).toBe(200);
    expect(SessionResponseSchema.parse(await repeated.json()).user.preferred_currency).toBe('EUR');

    const update = await app.request('/app-api/auth/preferences', {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ preferred_currency: 'GBP' }),
    });

    expect(update.status).toBe(200);
    expect(SessionResponseSchema.parse(await update.json()).user.preferred_currency).toBe('GBP');
  },
);

integrationTest(
  'initialization is authenticated and cannot create preferences for another account',
  async ({ app, user: first, createUser, authenticatedHeaders }) => {
    const second = await createUser();
    const payload = JSON.stringify({ preferred_currency: 'EUR', user_id: second.userId });

    const unauthenticated = await app.request('/app-api/auth/preferences', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
    });

    expect(unauthenticated.status).toBe(401);

    const initialized = await app.request('/app-api/auth/preferences', {
      method: 'POST',
      headers: authenticatedHeaders,
      body: payload,
    });

    expect(initialized.status).toBe(200);
    expect(SessionResponseSchema.parse(await initialized.json()).user.id).toBe(first.userId);

    const other = await app.request(SESSION_ROUTE_PATH, {
      headers: { Cookie: `better-auth.session_token=${second.sessionToken}` },
    });

    expect(SessionResponseSchema.parse(await other.json()).user.preferred_currency).toBe('USD');
  },
);

integrationTest(
  'an explicit update wins when initialization runs concurrently',
  async ({ app, authenticatedHeaders: headers }) => {
    const [initialized, updated] = await Promise.all([
      app.request('/app-api/auth/preferences', {
        method: 'POST',
        headers,
        body: JSON.stringify({ preferred_currency: 'EUR' }),
      }),
      app.request('/app-api/auth/preferences', {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ preferred_currency: 'GBP' }),
      }),
    ]);

    expect(initialized.status).toBe(200);
    expect(updated.status).toBe(200);
    const session = await app.request(SESSION_ROUTE_PATH, { headers });
    expect(SessionResponseSchema.parse(await session.json()).user.preferred_currency).toBe('GBP');
  },
);
