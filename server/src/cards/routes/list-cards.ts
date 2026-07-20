import { createRoute } from '@hono/zod-openapi';

import { STATUS_CODES } from '../../constants/http.ts';
import { MIME_TYPES } from '../../constants/request.ts';
import { ErrorResponseSchema } from '../../schemas/errors.ts';
import { requireLoggedInSessionMiddleware } from '../../auth/middleware.ts';
import { CARDS_OPENAPI_TAG, LIST_CARDS_PATH } from '../constants.ts';
import { CardsListResponseSchema } from '../schemas/responses.ts';

const listCardsRoute = createRoute({
  method: 'get',
  path: LIST_CARDS_PATH,
  tags: [CARDS_OPENAPI_TAG],
  summary: 'List card entries',
  description: "List the authenticated user's owned card entries ordered by newest first",
  middleware: [requireLoggedInSessionMiddleware] as const,
  security: [{ bearerAuth: [] }],
  responses: {
    [STATUS_CODES.OK]: {
      description: 'Card entries retrieved successfully',
      content: {
        [MIME_TYPES.JSON]: { schema: CardsListResponseSchema },
      },
    },
    [STATUS_CODES.NOT_FOUND]: {
      description: 'Session not found',
      content: {
        [MIME_TYPES.JSON]: { schema: ErrorResponseSchema },
      },
    },
  },
});

export default listCardsRoute;
