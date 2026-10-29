import { AuthResponseSchema, TokenHeaders } from '@kamaalio/kamaal-auth-hono';
import type { Hono } from 'hono';

import { CONTENTFUL_STATUS_CODES } from '../constants/http.ts';
import { MIME_TYPES } from '../constants/request.ts';
import type { HonoEnvironment } from '../context.ts';
import type { Currency } from '../forex/currencies.ts';
import { ErrorResponseSchema, ValidationErrorResponseSchema } from '../schemas/errors.ts';

export async function expectAuthSuccessResponse(response: Response, status: number) {
  expect(response.status).toBe(status);

  const body = AuthResponseSchema.parse(await response.json());

  const headers = TokenHeaders.parse({
    'set-auth-token': response.headers.get('set-auth-token'),
    'set-auth-token-expiry': response.headers.get('set-auth-token-expiry'),
    'set-session-token': response.headers.get('set-session-token'),
    'set-session-update-age': response.headers.get('set-session-update-age'),
  });

  return { body, headers };
}

export async function expectErrorResponse(response: Response, status: number) {
  expect(response.status).toBe(status);

  return ErrorResponseSchema.parse(await response.json());
}

export async function expectValidationIssueForField(response: Response, fieldName: string) {
  await expectValidationIssueForFields(response, [fieldName]);
}

export async function expectValidationIssueForFields(response: Response, fieldNames: string[]) {
  expect(response.status).toBe(CONTENTFUL_STATUS_CODES.BAD_REQUEST);

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

export function sessionHeaders(sessionToken: string) {
  return new Headers({
    'Content-Type': MIME_TYPES.JSON,
    Cookie: `better-auth.session_token=${sessionToken}`,
  });
}

export async function setPreferredCurrency(app: Hono<HonoEnvironment>, headers: Headers, currency: Currency) {
  const response = await app.request('/app-api/auth/preferences', {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ preferred_currency: currency }),
  });

  expect(response.status).toBe(CONTENTFUL_STATUS_CODES.OK);
}
