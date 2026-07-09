import assert from 'node:assert/strict';

import { decodeJwt } from 'jose';
import type { Hono } from 'hono';

import { ONE_DAY_IN_SECONDS } from '../../constants/common.ts';
import { STATUS_CODES } from '../../constants/http.ts';
import env from '../../env.ts';
import type { HonoEnvironment } from '../../context.ts';
import { expectErrorResponse } from '../../tests/auth.ts';
import { integrationTest } from '../../tests/fixtures.ts';
import { createTestUser } from '../../tests/utils.ts';
import { TOKEN_ROUTE_PATH } from '../handlers/token.ts';
import { TokenHeaders } from '../schemas/headers.ts';

describe('Token integration', () => {
  integrationTest(
    'returns a JWT and refresh headers for a valid session token',
    async ({ app, db, getLogsForRequestId, withRequestId }) => {
      const createdUser = await createTestUser(app, db);
      const { headers, requestId } = withRequestId({
        Authorization: `Bearer ${createdUser.sessionToken}`,
      });

      const response = await sendTokenRequest(app, headers);

      expect(response.status).toBe(STATUS_CODES.OK);
      const body = await response.json();
      const responseHeaders = TokenHeaders.parse({
        'set-auth-token': response.headers.get('set-auth-token'),
        'set-auth-token-expiry': response.headers.get('set-auth-token-expiry'),
        'set-session-token': response.headers.get('set-session-token'),
        'set-session-update-age': response.headers.get('set-session-update-age'),
      });
      const token = body.token;
      assert(typeof token === 'string');

      expect(token).toBe(responseHeaders['set-auth-token']);
      expect(Number(responseHeaders['set-auth-token-expiry'])).toBeGreaterThan(0);
      expect(responseHeaders['set-session-token']).toBe(createdUser.sessionToken);
      expect(Number(responseHeaders['set-session-update-age'])).toBe(
        ONE_DAY_IN_SECONDS * env.BETTER_AUTH_SESSION_UPDATE_AGE_DAYS,
      );
      expect(decodeJwt(token).sub).toBe(createdUser.userId);
      expect(getLogsForRequestId(requestId)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            event: 'auth.token.issued',
            request_id: requestId,
            route: TOKEN_ROUTE_PATH,
            component: 'auth',
            outcome: 'success',
          }),
        ]),
      );
    },
  );

  integrationTest('rejects a missing session token', async ({ app }) => {
    const response = await sendTokenRequest(app);

    await expectErrorResponse(response, STATUS_CODES.NOT_FOUND);
  });

  integrationTest('rejects an invalid session token', async ({ app }) => {
    const response = await sendTokenRequest(app, new Headers({ Authorization: 'Bearer invalid-session-token' }));

    await expectErrorResponse(response, STATUS_CODES.NOT_FOUND);
  });
});

async function sendTokenRequest(app: Hono<HonoEnvironment>, headers?: Headers) {
  return app.request(TOKEN_ROUTE_PATH, {
    method: 'GET',
    headers,
  });
}
