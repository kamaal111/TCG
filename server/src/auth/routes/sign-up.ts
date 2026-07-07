import { createRoute } from '@hono/zod-openapi';

import { AUTH_OPENAPI_TAG } from '../constants.ts';
import { MIME_TYPES } from '../../constants/request.ts';
import { STATUS_CODES } from '../../constants/http.ts';
import { AuthResponseSchema } from '../schemas/responses.ts';
import { TokenHeaders } from '../schemas/headers.ts';
import { ErrorResponseSchema, ValidationErrorResponseSchema } from '../../schemas/errors.ts';
import { EmailPasswordSignUpSchema } from '../schemas/payloads.ts';

const signUpRoute = createRoute({
  method: 'post',
  path: '/sign-up/email',
  tags: [AUTH_OPENAPI_TAG],
  summary: 'Sign up with email and password',
  description: 'Create a new user account with email and password',
  request: {
    body: {
      content: {
        [MIME_TYPES.JSON]: { schema: EmailPasswordSignUpSchema },
      },
    },
  },
  responses: {
    [STATUS_CODES.CREATED]: {
      description: 'Account created successfully',
      content: {
        [MIME_TYPES.JSON]: { schema: AuthResponseSchema },
      },
      headers: TokenHeaders,
    },
    [STATUS_CODES.BAD_REQUEST]: {
      description: 'Invalid request or email already exists',
      content: {
        [MIME_TYPES.JSON]: { schema: ValidationErrorResponseSchema },
      },
    },
    [STATUS_CODES.CONFLICT]: {
      description: 'Email already registered',
      content: {
        [MIME_TYPES.JSON]: { schema: ErrorResponseSchema },
      },
    },
    [STATUS_CODES.UNAUTHORIZED]: {
      description: 'Authentication failed or invalid credentials',
      content: {
        [MIME_TYPES.JSON]: { schema: ErrorResponseSchema },
      },
    },
  },
});

export default signUpRoute;
