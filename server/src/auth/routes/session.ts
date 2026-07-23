import { createRoute } from '@hono/zod-openapi';

import { STATUS_CODES } from '../../constants/http.ts';
import { ErrorResponseSchema } from '../../schemas/errors.ts';
import { AuthenticationHeaders } from '../../schemas/headers.ts';
import { AUTH_OPENAPI_TAG } from '../constants.ts';
import { requireLoggedInSessionMiddleware } from '../middleware.ts';
import { SessionResponseSchema } from '../schemas/responses.ts';

const sessionRoute = createRoute({
  method: 'get',
  path: '/session',
  tags: [AUTH_OPENAPI_TAG],
  summary: 'Get session',
  middleware: [requireLoggedInSessionMiddleware],
  description:
    'Get the current user session information. Can authenticate via either Authorization header (JWT bearer token) or session cookie.',
  request: {
    headers: AuthenticationHeaders.partial(),
  },
  responses: {
    [STATUS_CODES.OK]: {
      description: 'Session retrieved successfully',
      content: {
        'application/json': {
          schema: SessionResponseSchema,
        },
      },
    },
    [STATUS_CODES.UNAUTHORIZED]: {
      description: 'Session not found',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
  },
});

export default sessionRoute;
