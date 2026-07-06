import { createRoute, z } from '@hono/zod-openapi';

import { AUTH_OPENAPI_TAG } from '../constants.ts';
import { STATUS_CODES } from '../../constants/http.ts';
import { MIME_TYPES } from '../../constants/request.ts';
import { TokenHeaders } from '../schemas/headers.ts';
import { ErrorResponseSchema } from '../../schemas/errors.ts';

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
        [MIME_TYPES.APPLICATION_JSON]: { schema: TokenResponseSchema },
      },
      headers: TokenHeaders,
    },
    [STATUS_CODES.UNAUTHORIZED]: {
      description: 'Not authenticated or session expired',
      content: {
        [MIME_TYPES.APPLICATION_JSON]: { schema: ErrorResponseSchema },
      },
    },
  },
});

export default tokenRoute;
