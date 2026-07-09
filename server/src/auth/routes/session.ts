import { createRoute } from '@hono/zod-openapi';

import { AUTH_OPENAPI_TAG } from '../constants.ts';
import { requireLoggedInSessionMiddleware } from '../middleware.ts';
import { AuthenticationHeaders } from '../../schemas/headers.ts';
import { SessionResponseSchema } from '../schemas/responses.ts';
import { ErrorResponseSchema } from '../../schemas/errors.ts';

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
    200: {
      description: 'Session retrieved successfully',
      content: {
        'application/json': {
          schema: SessionResponseSchema,
        },
      },
    },
    404: {
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
