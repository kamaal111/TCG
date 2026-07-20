import { createRoute } from '@hono/zod-openapi';

import { requireLoggedInSessionMiddleware } from '../../auth/middleware.ts';
import { STATUS_CODES } from '../../constants/http.ts';
import { MIME_TYPES } from '../../constants/request.ts';
import { CardNotFoundErrorResponseSchema } from '../../schemas/errors.ts';
import { CARDS_OPENAPI_TAG } from '../constants.ts';
import { CardIdParamsSchema } from '../schemas/params.ts';
import { DeleteCardResponseSchema } from '../schemas/responses.ts';

const DELETE_CARD_PATH = '/{cardId}';

const deleteCardRoute = createRoute({
  method: 'delete',
  path: DELETE_CARD_PATH,
  tags: [CARDS_OPENAPI_TAG],
  summary: 'Delete an owned card',
  description: "Delete an owned card entry from the authenticated user's collection.",
  middleware: [requireLoggedInSessionMiddleware] as const,
  security: [{ bearerAuth: [] }],
  request: { params: CardIdParamsSchema },
  responses: {
    [STATUS_CODES.OK]: {
      description: 'Card deleted successfully',
      content: { [MIME_TYPES.JSON]: { schema: DeleteCardResponseSchema } },
    },
    [STATUS_CODES.NOT_FOUND]: {
      description: 'Session or card not found',
      content: { [MIME_TYPES.JSON]: { schema: CardNotFoundErrorResponseSchema } },
    },
  },
});

export default deleteCardRoute;
