import { createRoute } from '@hono/zod-openapi';

import { STATUS_CODES } from '../../constants/http.ts';
import { MIME_TYPES } from '../../constants/request.ts';
import { ErrorResponseSchema } from '../../schemas/errors.ts';
import { requireLoggedInSessionMiddleware } from '../../auth/middleware.ts';
import { CARDS_OPENAPI_TAG, DELETE_CARD_PATH } from '../constants.ts';
import { CardIdParamsSchema } from '../schemas/params.ts';
import { DeleteCardResponseSchema } from '../schemas/responses.ts';

const deleteCardRoute = createRoute({
  method: 'delete',
  path: DELETE_CARD_PATH,
  tags: [CARDS_OPENAPI_TAG],
  summary: 'Delete a card entry',
  description: 'Delete an owned card entry and its quantities per condition',
  middleware: [requireLoggedInSessionMiddleware] as const,
  security: [{ bearerAuth: [] }],
  request: {
    params: CardIdParamsSchema,
  },
  responses: {
    [STATUS_CODES.OK]: {
      description: 'Card entry deleted successfully',
      content: {
        [MIME_TYPES.JSON]: { schema: DeleteCardResponseSchema },
      },
    },
    [STATUS_CODES.NOT_FOUND]: {
      description: 'Session or card not found',
      content: {
        [MIME_TYPES.JSON]: { schema: ErrorResponseSchema },
      },
    },
  },
});

export default deleteCardRoute;
