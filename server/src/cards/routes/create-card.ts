import { createRoute } from '@hono/zod-openapi';

import { requireLoggedInSessionMiddleware } from '../../auth/middleware.ts';
import { STATUS_CODES } from '../../constants/http.ts';
import { MIME_TYPES } from '../../constants/request.ts';
import { ErrorResponseSchema, ValidationErrorResponseSchema } from '../../schemas/errors.ts';
import { CARDS_OPENAPI_TAG } from '../constants.ts';
import { UpsertCardSchema } from '../schemas/payloads.ts';
import { CardSchema } from '../schemas/responses.ts';

const CREATE_CARD_PATH = '/';

const createCardRoute = createRoute({
  method: 'post',
  path: CREATE_CARD_PATH,
  tags: [CARDS_OPENAPI_TAG],
  summary: 'Add an owned card',
  description: "Add an owned trading card entry to the authenticated user's collection.",
  middleware: [requireLoggedInSessionMiddleware] as const,
  security: [{ bearerAuth: [] }],
  request: { body: { content: { [MIME_TYPES.JSON]: { schema: UpsertCardSchema } } } },
  responses: {
    [STATUS_CODES.CREATED]: {
      description: 'Card added successfully',
      content: { [MIME_TYPES.JSON]: { schema: CardSchema } },
    },
    [STATUS_CODES.BAD_REQUEST]: {
      description: 'Invalid card details',
      content: { [MIME_TYPES.JSON]: { schema: ValidationErrorResponseSchema } },
    },
    [STATUS_CODES.NOT_FOUND]: {
      description: 'Authenticated session not found',
      content: { [MIME_TYPES.JSON]: { schema: ErrorResponseSchema } },
    },
  },
});

export default createCardRoute;
