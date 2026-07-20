import { createRoute } from '@hono/zod-openapi';

import { requireLoggedInSessionMiddleware } from '../../auth/middleware.ts';
import { STATUS_CODES } from '../../constants/http.ts';
import { MIME_TYPES } from '../../constants/request.ts';
import { ErrorResponseSchema } from '../../schemas/errors.ts';
import { CARDS_OPENAPI_TAG } from '../constants.ts';
import { CardsListResponseSchema } from '../schemas/responses.ts';

const LIST_CARDS_PATH = '/';

const listCardsRoute = createRoute({
  method: 'get',
  path: LIST_CARDS_PATH,
  tags: [CARDS_OPENAPI_TAG],
  summary: 'List owned cards',
  description: "List the authenticated user's owned card entries, newest first.",
  middleware: [requireLoggedInSessionMiddleware] as const,
  security: [{ bearerAuth: [] }],
  responses: {
    [STATUS_CODES.OK]: {
      description: 'Collection retrieved successfully',
      content: { [MIME_TYPES.JSON]: { schema: CardsListResponseSchema } },
    },
    [STATUS_CODES.NOT_FOUND]: {
      description: 'Authenticated session not found',
      content: { [MIME_TYPES.JSON]: { schema: ErrorResponseSchema } },
    },
  },
});

export default listCardsRoute;
