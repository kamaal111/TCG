import { createRoute } from '@hono/zod-openapi';

import { requireSessionMiddleware } from '../../auth/module.ts';
import { STATUS_CODES } from '../../constants/http.ts';
import { MIME_TYPES } from '../../constants/request.ts';
import { ErrorResponseSchema } from '../../schemas/errors.ts';
import { CARDS_OPENAPI_TAG } from '../constants.ts';
import { CardsListQuerySchema } from '../schemas/params.ts';
import { CardsListResponseSchema } from '../schemas/responses.ts';

const LIST_CARDS_PATH = '/';

const listCardsRoute = createRoute({
  method: 'get',
  path: LIST_CARDS_PATH,
  tags: [CARDS_OPENAPI_TAG],
  summary: 'List owned cards',
  description: "List the authenticated user's owned card entries, newest first.",
  middleware: [requireSessionMiddleware] as const,
  security: [{ bearerAuth: [] }],
  request: { query: CardsListQuerySchema },
  responses: {
    [STATUS_CODES.OK]: {
      description: 'Collection retrieved successfully',
      content: { [MIME_TYPES.JSON]: { schema: CardsListResponseSchema } },
    },
    [STATUS_CODES.UNAUTHORIZED]: {
      description: 'Authenticated session not found',
      content: { [MIME_TYPES.JSON]: { schema: ErrorResponseSchema } },
    },
    [STATUS_CODES.SERVICE_UNAVAILABLE]: {
      description: 'Pricing is temporarily unavailable because the upstream provider failed',
      content: { [MIME_TYPES.JSON]: { schema: ErrorResponseSchema } },
    },
  },
});

export default listCardsRoute;
