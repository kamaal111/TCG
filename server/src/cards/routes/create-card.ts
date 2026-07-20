import { createRoute } from '@hono/zod-openapi';

import { STATUS_CODES } from '../../constants/http.ts';
import { MIME_TYPES } from '../../constants/request.ts';
import { ErrorResponseSchema, ValidationErrorResponseSchema } from '../../schemas/errors.ts';
import { requireLoggedInSessionMiddleware } from '../../auth/middleware.ts';
import { CARDS_OPENAPI_TAG, CREATE_CARD_PATH } from '../constants.ts';
import { UpsertCardSchema } from '../schemas/payloads.ts';
import { CardSchema } from '../schemas/responses.ts';

const createCardRoute = createRoute({
  method: 'post',
  path: CREATE_CARD_PATH,
  tags: [CARDS_OPENAPI_TAG],
  summary: 'Create a card entry',
  description: 'Create a new owned card entry with quantities per condition for the authenticated user',
  middleware: [requireLoggedInSessionMiddleware] as const,
  security: [{ bearerAuth: [] }],
  request: {
    body: {
      content: {
        [MIME_TYPES.JSON]: { schema: UpsertCardSchema },
      },
    },
  },
  responses: {
    [STATUS_CODES.CREATED]: {
      description: 'Card entry created successfully',
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
      description: 'Session not found',
      content: {
        [MIME_TYPES.JSON]: { schema: ErrorResponseSchema },
      },
    },
  },
});

export default createCardRoute;
