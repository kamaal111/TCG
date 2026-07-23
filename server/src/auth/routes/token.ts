import { createRoute, z } from '@hono/zod-openapi';

import { STATUS_CODES } from '../../constants/http.ts';
import { MIME_TYPES } from '../../constants/request.ts';
import { ErrorResponseSchema } from '../../schemas/errors.ts';
import { AUTH_OPENAPI_TAG } from '../constants.ts';
import { TokenHeaders } from '../schemas/headers.ts';

const TokenResponseSchema = z
  .object({
    token: z.string().openapi({ description: 'JWT token', example: 'eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9...' }),
  })
  .openapi('TokenResponse');

const tokenRoute = createRoute({
  method: 'get',
  path: '/token',
  tags: [AUTH_OPENAPI_TAG],
  summary: 'Get JWT token',
  description: 'Get a new JWT token for the authenticated session. Use bearer token authentication.',
  security: [{ bearerAuth: [] }],
  responses: {
    [STATUS_CODES.OK]: {
      description: 'Token retrieved successfully',
      content: {
        [MIME_TYPES.JSON]: { schema: TokenResponseSchema },
      },
      headers: TokenHeaders,
    },
    [STATUS_CODES.UNAUTHORIZED]: {
      description: 'Not authenticated, session expired, or session not found',
      content: {
        [MIME_TYPES.JSON]: { schema: ErrorResponseSchema },
      },
    },
  },
});

export default tokenRoute;
