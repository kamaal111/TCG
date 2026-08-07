import { createRoute } from '@hono/zod-openapi';

import { requireSessionMiddleware } from '../../auth/module.ts';
import { STATUS_CODES } from '../../constants/http.ts';
import { MIME_TYPES } from '../../constants/request.ts';
import {
  CardNotFoundErrorResponseSchema,
  ErrorResponseSchema,
  ValidationErrorResponseSchema,
} from '../../schemas/errors.ts';
import { CARDS_OPENAPI_TAG } from '../constants.ts';
import { CardIdParamsSchema } from '../schemas/params.ts';
import { UpsertCardSchema } from '../schemas/payloads.ts';
import { CardWithPriceSchema } from '../schemas/responses.ts';

const UPDATE_CARD_PATH = '/{cardId}';

const updateCardRoute = createRoute({
  method: 'put',
  path: UPDATE_CARD_PATH,
  tags: [CARDS_OPENAPI_TAG],
  summary: 'Replace an owned card',
  description: 'Replace an owned card entry and all quantities for the authenticated user.',
  middleware: [requireSessionMiddleware] as const,
  security: [{ bearerAuth: [] }],
  request: {
    params: CardIdParamsSchema,
    body: { content: { [MIME_TYPES.JSON]: { schema: UpsertCardSchema } } },
  },
  responses: {
    [STATUS_CODES.OK]: {
      description: 'Card updated successfully',
      content: { [MIME_TYPES.JSON]: { schema: CardWithPriceSchema } },
    },
    [STATUS_CODES.BAD_REQUEST]: {
      description: 'Invalid card details',
      content: { [MIME_TYPES.JSON]: { schema: ValidationErrorResponseSchema } },
    },
    [STATUS_CODES.UNAUTHORIZED]: {
      description: 'Authenticated session not found',
      content: { [MIME_TYPES.JSON]: { schema: ErrorResponseSchema } },
    },
    [STATUS_CODES.NOT_FOUND]: {
      description: 'Card not found or not owned by the authenticated user',
      content: { [MIME_TYPES.JSON]: { schema: CardNotFoundErrorResponseSchema } },
    },
    [STATUS_CODES.SERVICE_UNAVAILABLE]: {
      description: 'Pricing is temporarily unavailable: the lock could not be acquired or the upstream failed',
      content: { [MIME_TYPES.JSON]: { schema: ErrorResponseSchema } },
    },
  },
});

export default updateCardRoute;
