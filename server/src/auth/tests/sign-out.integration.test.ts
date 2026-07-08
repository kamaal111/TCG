import type { Hono } from 'hono';

import { STATUS_CODES } from '../../constants/http.ts';
import { MIME_TYPES } from '../../constants/request.ts';
import type { HonoEnvironment } from '../../context.ts';
import { integrationTest } from '../../tests/fixtures.ts';
import { createTestUser } from '../../tests/utils.ts';
import { SIGN_OUT_ROUTE_PATH } from '../handlers/sign-out.ts';
import { SignOutResponseSchema } from '../schemas/payloads.ts';

describe('Sign-out integration', () => {
  integrationTest(
    'invalidates the current session, clears the session cookie, and logs the request',
    async ({ app, db, getLogsForRequestId, withRequestId }) => {
      const createdUser = await createTestUser(app, db);
      const sessionsBeforeSignOut = await db.query.session.findMany({
        where: { userId: createdUser.userId },
      });
      const { headers, requestId } = withRequestId({
        Cookie: `better-auth.session_token=${createdUser.sessionToken}`,
        'Content-Type': MIME_TYPES.JSON,
      });
      const response = await sendSignOutRequest(app, headers);

      expect(response.status).toBe(STATUS_CODES.OK);
      expect(SignOutResponseSchema.parse(await response.json())).toEqual({});
      expect(response.headers.get('set-cookie')).toContain('better-auth.session_token=');

      const sessionsAfterSignOut = await db.query.session.findMany({
        where: { userId: createdUser.userId },
      });
      const logs = getLogsForRequestId(requestId);
      const serializedLogs = JSON.stringify(logs);

      expect(sessionsBeforeSignOut).toHaveLength(1);
      expect(sessionsAfterSignOut).toHaveLength(0);
      expect(logs).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            event: 'auth.sign_out.succeeded',
            request_id: requestId,
            route: SIGN_OUT_ROUTE_PATH,
            component: 'auth',
            outcome: 'success',
          }),
        ]),
      );
      expect(serializedLogs).not.toContain(createdUser.sessionToken);
    },
  );

  integrationTest(
    'returns success and an expired session cookie when no active session is present',
    async ({ app, getLogsForRequestId, withRequestId }) => {
      const { headers, requestId } = withRequestId({ 'Content-Type': MIME_TYPES.JSON });
      const response = await sendSignOutRequest(app, headers);

      expect(response.status).toBe(STATUS_CODES.OK);
      expect(SignOutResponseSchema.parse(await response.json())).toEqual({});
      expect(response.headers.get('set-cookie')).toContain('better-auth.session_token=');

      const logs = getLogsForRequestId(requestId);
      expect(logs).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            event: 'auth.sign_out.succeeded',
            request_id: requestId,
            route: SIGN_OUT_ROUTE_PATH,
            component: 'auth',
            outcome: 'success',
          }),
        ]),
      );
    },
  );
});

async function sendSignOutRequest(app: Hono<HonoEnvironment>, headers?: Headers) {
  return app.request(SIGN_OUT_ROUTE_PATH, {
    method: 'POST',
    headers:
      headers ??
      new Headers({
        'Content-Type': MIME_TYPES.JSON,
      }),
  });
}
