import type { Hono } from 'hono';

import { STATUS_CODES } from '../../constants/http.ts';
import { MIME_TYPES } from '../../constants/request.ts';
import type { HonoEnvironment } from '../../context.ts';
import { expectAuthSuccessResponse, expectErrorResponse } from '../../tests/auth.ts';
import { integrationTest } from '../../tests/fixtures.ts';
import { createTestUser } from '../../tests/utils.ts';
import { SIGN_IN_ROUTE_PATH } from '../handlers/sign-in.ts';
import { SessionResponseSchema } from '../schemas/responses.ts';
import { SESSION_ROUTE_PATH } from '../handlers/session.ts';

describe('Session integration', () => {
  integrationTest(
    'returns the current user session for a valid session cookie',
    async ({ app, db, getLogsForRequestId, withRequestId }) => {
      const createdUser = await createTestUser(app, db);
      const { headers, requestId } = withRequestId({
        Cookie: `better-auth.session_token=${createdUser.sessionToken}`,
        'User-Agent': 'TCG integration test client',
      });

      const response = await sendSessionRequest(app, headers);

      expect(response.status).toBe(STATUS_CODES.OK);
      const body = SessionResponseSchema.parse(await response.json());
      const persistedUser = await db.query.user.findFirst({
        where: { id: createdUser.userId },
      });

      expect(persistedUser).toBeDefined();
      expect(body.user).toMatchObject({
        id: createdUser.userId,
        name: createdUser.name,
        email: createdUser.email,
        email_verified: false,
      });
      expect(body.session).toEqual(
        expect.objectContaining({
          expires_at: expect.any(String),
          created_at: expect.any(String),
          updated_at: expect.any(String),
        }),
      );
      expect(getLogsForRequestId(requestId)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            event: 'auth.session.lookup',
            msg: 'Retrieved the authenticated user session.',
            request_id: requestId,
            component: 'auth',
            outcome: 'success',
            user_id: createdUser.userId,
            user_agent: 'TCG integration test client',
          }),
        ]),
      );
    },
  );

  integrationTest(
    'returns the current user session for a valid bearer token',
    async ({ app, db, getLogsForRequestId, withRequestId }) => {
      const createdUser = await createTestUser(app, db);
      const signInResponse = await app.request(SIGN_IN_ROUTE_PATH, {
        method: 'POST',
        headers: new Headers({ 'Content-Type': MIME_TYPES.JSON }),
        body: JSON.stringify({
          email: createdUser.email,
          password: createdUser.password,
        }),
      });
      const { headers } = await expectAuthSuccessResponse(signInResponse, STATUS_CODES.OK);

      const { headers: requestHeaders, requestId } = withRequestId({
        Authorization: `Bearer ${headers['set-auth-token']}`,
        'User-Agent': 'TCG integration test client',
      });
      const response = await sendSessionRequest(app, requestHeaders);

      expect(response.status).toBe(STATUS_CODES.OK);
      const body = SessionResponseSchema.parse(await response.json());

      expect(body.user).toMatchObject({
        id: createdUser.userId,
        name: createdUser.name,
        email: createdUser.email,
        email_verified: false,
      });
      expect(getLogsForRequestId(requestId)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            event: 'auth.jwt.verification',
            msg: 'Verified authentication token.',
            request_id: requestId,
            component: 'auth',
            outcome: 'success',
            user_id: createdUser.userId,
          }),
        ]),
      );
    },
  );

  integrationTest('returns a not-found error without an authenticated session', async ({ app }) => {
    const response = await sendSessionRequest(app);

    const body = await expectErrorResponse(response, STATUS_CODES.NOT_FOUND);

    expect(body).toEqual({
      message: 'Not found',
      code: 'NOT_FOUND',
    });
  });
});

async function sendSessionRequest(app: Hono<HonoEnvironment>, headers?: Headers) {
  return app.request(SESSION_ROUTE_PATH, {
    method: 'GET',
    headers,
  });
}
