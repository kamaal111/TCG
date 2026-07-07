import crypto from 'node:crypto';
import assert from 'node:assert/strict';

import { decodeJwt } from 'jose';
import type { Hono } from 'hono';

import { ONE_DAY_IN_SECONDS } from '../../constants/common.ts';
import { STATUS_CODES } from '../../constants/http.ts';
import env from '../../env.ts';
import { SIGN_UP_ROUTE_PATH } from '../handlers/sign-up.ts';
import { integrationTest } from '../../tests/fixtures.ts';
import type { HonoEnvironment } from '../../context.ts';
import { MIME_TYPES } from '../../constants/request.ts';
import {
  expectAuthSuccessResponse,
  expectErrorResponse,
  expectValidationIssueForField,
  expectValidationIssueForFields,
} from '../../tests/auth.ts';

describe('Sign-up integration', () => {
  integrationTest(
    'creates a persisted user account and returns auth/session headers',
    async ({ app, db, getLogsForRequestId, withRequestId }) => {
      const payload = createValidSignUpPayload();
      const { headers, requestId } = withRequestId({ 'Content-Type': 'application/json' });
      const response = await sendSignUpRequest(app, payload, headers);

      const { body, headers: responseHeaders } = await expectAuthSuccessResponse(response, STATUS_CODES.CREATED);
      const persistedUser = await db.query.user.findFirst({
        where: { email: payload.email },
      });
      expect(persistedUser).toBeDefined();
      assert(persistedUser);

      const persistedAccounts = await db.query.account.findMany({
        where: { userId: persistedUser.id },
      });
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
      expect(persistedUser).toMatchObject({
        name: payload.name,
        email: payload.email,
        emailVerified: false,
      });
      expect(persistedAccounts).toHaveLength(1);
      expect(persistedAccounts[0]?.password).toBeTruthy();
      expect(persistedAccounts[0]?.password).not.toBe(payload.password);
      expect(persistedSessions).toHaveLength(1);
      expect(logs).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            event: 'auth.sign_up.succeeded',
            request_id: requestId,
            route: SIGN_UP_ROUTE_PATH,
            component: 'auth',
            outcome: 'success',
          }),
        ]),
      );
      expect(serializedLogs).not.toContain(payload.email);
      expect(serializedLogs).not.toContain(payload.password);
      expect(serializedLogs).not.toContain(payload.name);
    },
  );

  integrationTest('rejects duplicate email sign ups without duplicating persisted auth rows', async ({ app, db }) => {
    const payload = createValidSignUpPayload();
    const firstResponse = await sendSignUpRequest(app, payload);
    await expectAuthSuccessResponse(firstResponse, STATUS_CODES.CREATED);

    const duplicateResponse = await sendSignUpRequest(app, payload);
    const body = await expectErrorResponse(duplicateResponse, STATUS_CODES.CONFLICT);
    const persistedUser = await db.query.user.findFirst({
      where: { email: payload.email },
    });
    assert(persistedUser);
    const persistedUsers = await db.query.user.findMany({
      where: { email: payload.email },
    });
    const persistedAccounts = await db.query.account.findMany({
      where: { userId: persistedUser.id },
    });

    expect(body.code).toBe('USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL');
    expect(persistedUsers).toHaveLength(1);
    expect(persistedAccounts).toHaveLength(1);
  });

  integrationTest('accepts a valid app callback URL', async ({ app }) => {
    const response = await sendSignUpRequest(app, {
      ...createValidSignUpPayload(),
      callbackURL: 'tcg://signup-complete',
    });

    await expectAuthSuccessResponse(response, STATUS_CODES.CREATED);
  });

  describe('payload validation', () => {
    integrationTest('rejects a missing body', async ({ app }) => {
      const response = await app.request(SIGN_UP_ROUTE_PATH, {
        method: 'POST',
        headers: new Headers({ 'Content-Type': MIME_TYPES.JSON }),
      });

      expect(response.status).toBe(STATUS_CODES.BAD_REQUEST);
      expect(await response.text()).toContain('Malformed JSON in request body');
    });

    integrationTest('rejects an empty object', async ({ app }) => {
      const response = await sendSignUpRequest(app, {});

      await expectValidationIssueForFields(response, ['email', 'password', 'name']);
    });

    integrationTest('rejects an invalid email', async ({ app }) => {
      const response = await sendSignUpRequest(app, {
        ...createValidSignUpPayload(),
        email: 'invalid-email',
      });

      await expectValidationIssueForField(response, 'email');
    });

    integrationTest('rejects a short password', async ({ app }) => {
      const response = await sendSignUpRequest(app, {
        ...createValidSignUpPayload(),
        password: 'short',
      });

      await expectValidationIssueForField(response, 'password');
    });

    integrationTest('rejects a password longer than 128 characters', async ({ app }) => {
      const response = await sendSignUpRequest(app, {
        ...createValidSignUpPayload(),
        password: 'a'.repeat(129),
      });

      await expectValidationIssueForField(response, 'password');
    });

    integrationTest('rejects a name that is too short', async ({ app }) => {
      const response = await sendSignUpRequest(app, {
        ...createValidSignUpPayload(),
        name: 'Al',
      });

      await expectValidationIssueForField(response, 'name');
    });

    integrationTest('rejects a single-word name', async ({ app }) => {
      const response = await sendSignUpRequest(app, {
        ...createValidSignUpPayload(),
        name: 'Prince',
      });

      await expectValidationIssueForField(response, 'name');
    });

    integrationTest('rejects leading or trailing name whitespace', async ({ app }) => {
      const response = await sendSignUpRequest(app, {
        ...createValidSignUpPayload(),
        name: ' Test User ',
      });

      await expectValidationIssueForField(response, 'name');
    });

    integrationTest('rejects multiple spaces between name words', async ({ app }) => {
      const response = await sendSignUpRequest(app, {
        ...createValidSignUpPayload(),
        name: 'Test  User',
      });

      await expectValidationIssueForField(response, 'name');
    });

    integrationTest('rejects a name word without letters', async ({ app }) => {
      const response = await sendSignUpRequest(app, {
        ...createValidSignUpPayload(),
        name: 'John 123',
      });

      await expectValidationIssueForField(response, 'name');
    });

    integrationTest('rejects an invalid callback URL', async ({ app }) => {
      const response = await sendSignUpRequest(app, {
        ...createValidSignUpPayload(),
        callbackURL: 'not-a-url',
      });

      await expectValidationIssueForField(response, 'callbackURL');
    });
  });
});

function createValidSignUpPayload() {
  return {
    email: `test_${crypto.randomUUID()}@example.com`,
    password: 'password123',
    name: 'Test User',
  };
}

async function sendSignUpRequest(app: Hono<HonoEnvironment>, payload: unknown, headers?: Headers) {
  return app.request(SIGN_UP_ROUTE_PATH, {
    method: 'POST',
    headers:
      headers ??
      new Headers({
        'Content-Type': 'application/json',
      }),
    body: JSON.stringify(payload),
  });
}
