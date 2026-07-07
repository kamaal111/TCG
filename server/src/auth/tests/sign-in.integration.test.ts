import crypto from 'node:crypto';
import assert from 'node:assert/strict';

import { decodeJwt } from 'jose';
import type { Hono } from 'hono';

import { ONE_DAY_IN_SECONDS } from '../../constants/common.ts';
import { STATUS_CODES } from '../../constants/http.ts';
import env from '../../env.ts';
import { ErrorResponseSchema, ValidationErrorResponseSchema } from '../../schemas/errors.ts';
import type { HonoEnvironment } from '../../context.ts';
import { MIME_TYPES } from '../../constants/request.ts';
import { SIGN_IN_ROUTE_PATH } from '../handlers/sign-in.ts';
import { TokenHeaders } from '../schemas/headers.ts';
import { AuthResponseSchema } from '../schemas/responses.ts';
import { integrationTest } from '../../tests/fixtures.ts';
import { createTestUser } from '../../tests/utils.ts';

describe('Sign-in integration', () => {
  integrationTest(
    'creates a new session and returns auth/session headers for a valid user',
    async ({ app, db, getLogsForRequestId, withRequestId }) => {
      const createdUser = await createTestUser(app, db);
      const initialSessions = await db.query.session.findMany({
        where: { userId: createdUser.userId },
      });
      const payload = createValidSignInPayload({
        email: createdUser.email,
        password: createdUser.password,
      });
      const { headers, requestId } = withRequestId({ 'Content-Type': MIME_TYPES.APPLICATION_JSON });
      const response = await sendSignInRequest(app, payload, headers);

      const { body, headers: responseHeaders } = await expectSuccessfulSignInResponse(response);
      const persistedUser = await db.query.user.findFirst({
        where: { email: createdUser.email },
      });
      assert(persistedUser);

      const persistedSessions = await db.query.session.findMany({
        where: { userId: persistedUser.id },
      });
      const logs = getLogsForRequestId(requestId);
      const serializedLogs = JSON.stringify(logs);
      const decodedAuthToken = decodeJwt(responseHeaders['set-auth-token']);

      expect(body.token).toBeTruthy();
      expect(Number(responseHeaders['set-auth-token-expiry'])).toBeGreaterThan(0);
      expect(Number(responseHeaders['set-session-update-age'])).toBe(
        ONE_DAY_IN_SECONDS * env.BETTER_AUTH_SESSION_UPDATE_AGE_DAYS,
      );
      expect(decodedAuthToken.sub).toBe(persistedUser.id);
      expect(persistedSessions).toHaveLength(initialSessions.length + 1);
      expect(logs).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            event: 'auth.sign_in.succeeded',
            request_id: requestId,
            route: SIGN_IN_ROUTE_PATH,
            component: 'auth',
            outcome: 'success',
          }),
        ]),
      );
      expect(serializedLogs).not.toContain(payload.email);
      expect(serializedLogs).not.toContain(payload.password);
    },
  );

  integrationTest('rejects unknown credentials', async ({ app }) => {
    const response = await sendSignInRequest(app, createValidSignInPayload());

    const body = await expectErrorResponse(response, STATUS_CODES.UNAUTHORIZED);

    expect(body.code).toBe('INVALID_EMAIL_OR_PASSWORD');
  });

  integrationTest('rejects an incorrect password for an existing user', async ({ app, db }) => {
    const createdUser = await createTestUser(app, db);
    const response = await sendSignInRequest(
      app,
      createValidSignInPayload({
        email: createdUser.email,
        password: 'wrong-password',
      }),
    );

    const body = await expectErrorResponse(response, STATUS_CODES.UNAUTHORIZED);

    expect(body.code).toBe('INVALID_EMAIL_OR_PASSWORD');
  });

  integrationTest('accepts a valid app callback URL', async ({ app, db }) => {
    const createdUser = await createTestUser(app, db);
    const response = await sendSignInRequest(app, {
      email: createdUser.email,
      password: createdUser.password,
      callbackURL: 'tcg://sign-in-complete',
    });

    await expectSuccessfulSignInResponse(response);
  });

  describe('payload validation', () => {
    integrationTest('rejects a missing body', async ({ app }) => {
      const response = await app.request(SIGN_IN_ROUTE_PATH, {
        method: 'POST',
        headers: new Headers({ 'Content-Type': MIME_TYPES.APPLICATION_JSON }),
      });

      expect(response.status).toBe(STATUS_CODES.BAD_REQUEST);
      expect(await response.text()).toContain('Malformed JSON in request body');
    });

    integrationTest('rejects an empty object', async ({ app }) => {
      const response = await sendSignInRequest(app, {});

      await expectValidationIssueForFields(response, ['email', 'password']);
    });

    integrationTest('rejects an invalid email', async ({ app }) => {
      const response = await sendSignInRequest(app, {
        ...createValidSignInPayload(),
        email: 'invalid-email',
      });

      await expectValidationIssueForField(response, 'email');
    });

    integrationTest('rejects a short password', async ({ app }) => {
      const response = await sendSignInRequest(app, {
        ...createValidSignInPayload(),
        password: 'short',
      });

      await expectValidationIssueForField(response, 'password');
    });

    integrationTest('rejects an invalid callback URL', async ({ app }) => {
      const response = await sendSignInRequest(app, {
        ...createValidSignInPayload(),
        callbackURL: 'not-a-url',
      });

      await expectValidationIssueForField(response, 'callbackURL');
    });
  });
});

function createValidSignInPayload(overrides: Partial<{ callbackURL: string; email: string; password: string }> = {}) {
  return {
    email: `test_${crypto.randomUUID()}@example.com`,
    password: 'password123',
    ...overrides,
  };
}

async function sendSignInRequest(app: Hono<HonoEnvironment>, payload: unknown, headers?: Headers) {
  return app.request(SIGN_IN_ROUTE_PATH, {
    method: 'POST',
    headers:
      headers ??
      new Headers({
        'Content-Type': MIME_TYPES.APPLICATION_JSON,
      }),
    body: JSON.stringify(payload),
  });
}

async function expectSuccessfulSignInResponse(response: Response) {
  expect(response.status).toBe(STATUS_CODES.OK);

  const body = AuthResponseSchema.parse(await response.json());
  const headers = TokenHeaders.parse({
    'set-auth-token': response.headers.get('set-auth-token'),
    'set-auth-token-expiry': response.headers.get('set-auth-token-expiry'),
    'set-session-token': response.headers.get('set-session-token'),
    'set-session-update-age': response.headers.get('set-session-update-age'),
  });

  return { body, headers };
}

async function expectErrorResponse(response: Response, status: number) {
  expect(response.status).toBe(status);

  return ErrorResponseSchema.parse(await response.json());
}

async function expectValidationIssueForField(response: Response, fieldName: string) {
  await expectValidationIssueForFields(response, [fieldName]);
}

async function expectValidationIssueForFields(response: Response, fieldNames: string[]) {
  expect(response.status).toBe(STATUS_CODES.BAD_REQUEST);

  const body = ValidationErrorResponseSchema.parse(await response.json());
  expect(body.message).toBe('Invalid payload');
  expect(body.code).toBe('INVALID_PAYLOAD');

  for (const fieldName of fieldNames) {
    const hasMatchingIssue =
      body.context?.validations.some(issue => {
        const path = issue.path.length > 0 ? issue.path : ['<root>'];
        return path.includes(fieldName);
      }) ?? false;

    expect(hasMatchingIssue).toBe(true);
  }
}
