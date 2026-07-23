import { createRoute } from '@hono/zod-openapi';

import { requireLoggedInSessionMiddleware } from '../../auth/middleware.ts';
import { STATUS_CODES } from '../../constants/http.ts';
import { MIME_TYPES } from '../../constants/request.ts';
import { ErrorResponseSchema, ValidationErrorResponseSchema } from '../../schemas/errors.ts';
import { PRICING_OPENAPI_TAG } from '../constants.ts';
import { OwnedPricingQuerySchema } from '../schemas/params.ts';
import { OwnedPricingResponseSchema } from '../schemas/responses.ts';

const ownedPricingRoute = createRoute({
  method: 'get',
  path: '/owned',
  tags: [PRICING_OPENAPI_TAG],
  summary: 'Price the owned collection',
  description: 'Return current daily pricing for every owned card in one request.',
  middleware: [requireLoggedInSessionMiddleware] as const,
  security: [{ bearerAuth: [] }],
  request: { query: OwnedPricingQuerySchema },
  responses: {
    [STATUS_CODES.OK]: {
      description: 'Owned card pricing retrieved',
      content: { [MIME_TYPES.JSON]: { schema: OwnedPricingResponseSchema } },
    },
    [STATUS_CODES.BAD_REQUEST]: {
      description: 'Invalid game filter',
      content: { [MIME_TYPES.JSON]: { schema: ValidationErrorResponseSchema } },
    },
    [STATUS_CODES.NOT_FOUND]: {
      description: 'Authenticated session not found',
      content: { [MIME_TYPES.JSON]: { schema: ErrorResponseSchema } },
    },
    [STATUS_CODES.SERVICE_UNAVAILABLE]: {
      description: 'Pricing lock could not be acquired before the timeout',
      content: { [MIME_TYPES.JSON]: { schema: ErrorResponseSchema } },
    },
  },
});

export default ownedPricingRoute;
