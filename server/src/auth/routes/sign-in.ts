import { createRoute } from '@hono/zod-openapi';

import { AUTH_OPENAPI_TAG } from '../constants.ts';
import { MIME_TYPES } from '../../constants/request.ts';
import { STATUS_CODES } from '../../constants/http.ts';
import { AuthResponseSchema } from '../schemas/responses.ts';
import { TokenHeaders } from '../schemas/headers.ts';
import { ErrorResponseSchema, ValidationErrorResponseSchema } from '../../schemas/errors.ts';
import { EmailPasswordSignInSchema } from '../schemas/payloads.ts';

const signInRoute = createRoute({
  method: 'post',
  path: '/sign-in/email',
  tags: [AUTH_OPENAPI_TAG],
  summary: 'Sign in with email and password',
  description: 'Authenticate a user with email and password credentials',
  request: {
    body: {
      content: {
        [MIME_TYPES.APPLICATION_JSON]: { schema: EmailPasswordSignInSchema },
      },
    },
  },
  responses: {
    [STATUS_CODES.OK]: {
      description: 'Sign in successful',
      content: {
        [MIME_TYPES.APPLICATION_JSON]: { schema: AuthResponseSchema },
      },
      headers: TokenHeaders,
    },
    [STATUS_CODES.BAD_REQUEST]: {
      description: 'Invalid credentials or request',
      content: {
        [MIME_TYPES.APPLICATION_JSON]: { schema: ValidationErrorResponseSchema },
      },
    },
    [STATUS_CODES.UNAUTHORIZED]: {
      description: 'Authentication failed',
      content: {
        [MIME_TYPES.APPLICATION_JSON]: { schema: ErrorResponseSchema },
      },
    },
  },
});

export default signInRoute;
