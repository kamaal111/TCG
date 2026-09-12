import { createRoute, type RouteConfigToTypedResponse } from '@kamaalio/hono-standard-openapi';

import { requireSessionMiddleware } from '../../auth/module.ts';
import { CONTENTFUL_STATUS_CODES } from '../../constants/http.ts';
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

export type UpdateCardRouteResponse = RouteConfigToTypedResponse<typeof updateCardRoute>;

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
    [CONTENTFUL_STATUS_CODES.OK]: {
      description: 'Card updated successfully',
      content: { [MIME_TYPES.JSON]: { schema: CardWithPriceSchema } },
    },
    [CONTENTFUL_STATUS_CODES.BAD_REQUEST]: {
      description: 'Invalid card details',
      content: { [MIME_TYPES.JSON]: { schema: ValidationErrorResponseSchema } },
    },
    [CONTENTFUL_STATUS_CODES.UNAUTHORIZED]: {
      description: 'Authenticated session not found',
      content: { [MIME_TYPES.JSON]: { schema: ErrorResponseSchema } },
    },
    [CONTENTFUL_STATUS_CODES.NOT_FOUND]: {
      description: 'Card not found or not owned by the authenticated user',
      content: { [MIME_TYPES.JSON]: { schema: CardNotFoundErrorResponseSchema } },
    },
    [CONTENTFUL_STATUS_CODES.SERVICE_UNAVAILABLE]: {
      description: 'Pricing is temporarily unavailable: the lock could not be acquired or the upstream failed',
      content: { [MIME_TYPES.JSON]: { schema: ErrorResponseSchema } },
    },
  },
});

export default updateCardRoute;
