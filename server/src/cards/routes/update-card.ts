import { createRoute } from '@hono/zod-openapi';

import { requireLoggedInSessionMiddleware } from '../../auth/middleware.ts';
import { STATUS_CODES } from '../../constants/http.ts';
import { MIME_TYPES } from '../../constants/request.ts';
import { CardNotFoundErrorResponseSchema, ValidationErrorResponseSchema } from '../../schemas/errors.ts';
import { CARDS_OPENAPI_TAG } from '../constants.ts';
import { CardIdParamsSchema } from '../schemas/params.ts';
import { UpsertCardSchema } from '../schemas/payloads.ts';
import { CardSchema } from '../schemas/responses.ts';

const UPDATE_CARD_PATH = '/{cardId}';

const updateCardRoute = createRoute({
  method: 'put',
  path: UPDATE_CARD_PATH,
  tags: [CARDS_OPENAPI_TAG],
  summary: 'Replace an owned card',
  description: 'Replace an owned card entry and all quantities for the authenticated user.',
  middleware: [requireLoggedInSessionMiddleware] as const,
  security: [{ bearerAuth: [] }],
  request: {
    params: CardIdParamsSchema,
    body: { content: { [MIME_TYPES.JSON]: { schema: UpsertCardSchema } } },
  },
  responses: {
    [STATUS_CODES.OK]: {
      description: 'Card updated successfully',
      content: { [MIME_TYPES.JSON]: { schema: CardSchema } },
    },
    [STATUS_CODES.BAD_REQUEST]: {
      description: 'Invalid card details',
      content: { [MIME_TYPES.JSON]: { schema: ValidationErrorResponseSchema } },
    },
    [STATUS_CODES.NOT_FOUND]: {
      description: 'Session or card not found',
      content: { [MIME_TYPES.JSON]: { schema: CardNotFoundErrorResponseSchema } },
    },
  },
});

export default updateCardRoute;
