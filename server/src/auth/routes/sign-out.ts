import { createRoute } from '@hono/zod-openapi';

import { STATUS_CODES } from '../../constants/http.ts';
import { MIME_TYPES } from '../../constants/request.ts';
import { ErrorResponseSchema } from '../../schemas/errors.ts';
import { AUTH_OPENAPI_TAG } from '../constants.ts';
import { SignOutResponseSchema } from '../schemas/payloads.ts';

const signOutRoute = createRoute({
  method: 'post',
  path: '/sign-out',
  tags: [AUTH_OPENAPI_TAG],
  summary: 'Sign out',
  description: 'Sign out the current user and invalidate the session',
  responses: {
    [STATUS_CODES.OK]: {
      description: 'Sign out successful',
      content: {
        [MIME_TYPES.JSON]: {
          schema: SignOutResponseSchema,
        },
      },
    },
    [STATUS_CODES.UNAUTHORIZED]: {
      description: 'Authentication failed',
      content: {
        [MIME_TYPES.JSON]: {
          schema: ErrorResponseSchema,
        },
      },
    },
  },
});

export default signOutRoute;
