import { createRoute } from '@hono/zod-openapi';

import { STATUS_CODES } from '../../constants/http.ts';
import { MIME_TYPES } from '../../constants/request.ts';
import { ErrorResponseSchema, ValidationErrorResponseSchema } from '../../schemas/errors.ts';
import { requireLoggedInSessionMiddleware } from '../../auth/middleware.ts';
import { CARDS_OPENAPI_TAG, UPDATE_CARD_PATH } from '../constants.ts';
import { CardIdParamsSchema } from '../schemas/params.ts';
import { UpsertCardSchema } from '../schemas/payloads.ts';
import { CardSchema } from '../schemas/responses.ts';

const updateCardRoute = createRoute({
  method: 'put',
  path: UPDATE_CARD_PATH,
  tags: [CARDS_OPENAPI_TAG],
  summary: 'Update a card entry',
  description: 'Fully replace an owned card entry, including its quantities per condition',
  middleware: [requireLoggedInSessionMiddleware] as const,
  security: [{ bearerAuth: [] }],
  request: {
    params: CardIdParamsSchema,
    body: {
      content: {
        [MIME_TYPES.JSON]: { schema: UpsertCardSchema },
      },
    },
  },
  responses: {
    [STATUS_CODES.OK]: {
      description: 'Card entry updated successfully',
      content: {
        [MIME_TYPES.JSON]: { schema: CardSchema },
      },
    },
    [STATUS_CODES.BAD_REQUEST]: {
      description: 'Invalid request payload',
      content: {
        [MIME_TYPES.JSON]: { schema: ValidationErrorResponseSchema },
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

export default updateCardRoute;
