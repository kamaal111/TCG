import { createRoute } from '@hono/zod-openapi';

import { requireLoggedInSessionMiddleware } from '../../auth/middleware.ts';
import { STATUS_CODES } from '../../constants/http.ts';
import { MIME_TYPES } from '../../constants/request.ts';
import { ErrorResponseSchema, ValidationErrorResponseSchema } from '../../schemas/errors.ts';
import { PRICING_OPENAPI_TAG } from '../constants.ts';
import { PricingSearchQuerySchema } from '../schemas/params.ts';
import { PricingSearchResponseSchema } from '../schemas/responses.ts';

const searchPricingRoute = createRoute({
  method: 'get',
  path: '/search',
  tags: [PRICING_OPENAPI_TAG],
  summary: 'Search card prices',
  description: 'Search TCGGO for cards and return globally cached daily pricing.',
  middleware: [requireLoggedInSessionMiddleware] as const,
  security: [{ bearerAuth: [] }],
  request: { query: PricingSearchQuerySchema },
  responses: {
    [STATUS_CODES.OK]: {
      description: 'Pricing search completed',
      content: { [MIME_TYPES.JSON]: { schema: PricingSearchResponseSchema } },
    },
    [STATUS_CODES.BAD_REQUEST]: {
      description: 'Invalid search query',
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

export default searchPricingRoute;
