import { STATUS_CODES } from '../constants/http.ts';
import { ErrorResponseSchema, ValidationErrorResponseSchema } from '../schemas/errors.ts';
import { TokenHeaders } from '../auth/schemas/headers.ts';
import { AuthResponseSchema } from '../auth/schemas/responses.ts';

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
