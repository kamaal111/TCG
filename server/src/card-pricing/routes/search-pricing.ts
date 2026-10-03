import { createRoute, defineOpenAPIRoute } from '@kamaalio/hono-standard-openapi';

import { requireSessionMiddleware } from '../../auth/module.ts';
import { APP_API_ROUTE_NAME } from '../../constants/common.ts';
import { CONTENTFUL_STATUS_CODES } from '../../constants/http.ts';
import { MIME_TYPES } from '../../constants/request.ts';
import type { HonoEnvironment } from '../../context.ts';
import { ErrorResponseSchema, ValidationErrorResponseSchema } from '../../schemas/errors.ts';
import { PRICING_OPENAPI_TAG, PRICING_ROUTE_NAME } from '../constants.ts';
import { parseCardLanguages } from '../languages.ts';
import { pricingLogger } from '../logging.ts';
import { PricingSearchQuerySchema } from '../schemas/params.ts';
import type { PricingSearchResponse } from '../schemas/responses.ts';
import { PricingSearchResponseSchema } from '../schemas/responses.ts';

const routeConfig = createRoute({
  method: 'get',
  path: '/search',
  tags: [PRICING_OPENAPI_TAG],
  summary: 'Search card prices',
  description: 'Search cards and return globally cached daily pricing.',
  middleware: [requireSessionMiddleware] as const,
  security: [{ bearerAuth: [] }],
  request: { query: PricingSearchQuerySchema },
  responses: {
    [CONTENTFUL_STATUS_CODES.OK]: {
      description: 'Pricing search completed',
      content: { [MIME_TYPES.JSON]: { schema: PricingSearchResponseSchema } },
    },
    [CONTENTFUL_STATUS_CODES.BAD_REQUEST]: {
      description: 'Invalid search query',
      content: { [MIME_TYPES.JSON]: { schema: ValidationErrorResponseSchema } },
    },
    [CONTENTFUL_STATUS_CODES.UNAUTHORIZED]: {
      description: 'Authenticated session not found',
      content: { [MIME_TYPES.JSON]: { schema: ErrorResponseSchema } },
    },
    [CONTENTFUL_STATUS_CODES.SERVICE_UNAVAILABLE]: {
      description: 'Pricing is temporarily unavailable: the lock could not be acquired or the upstream failed',
      content: { [MIME_TYPES.JSON]: { schema: ErrorResponseSchema } },
    },
  },
});

export const SEARCH_PRICING_ROUTE_PATH = `${APP_API_ROUTE_NAME}${PRICING_ROUTE_NAME}/search` as const;

const searchPricingRoute = defineOpenAPIRoute<HonoEnvironment, typeof routeConfig>({
  route: routeConfig,
  handler: async c => {
    const { game, query, languages } = c.req.valid('query');
    const result = await c.get('cardPricingService').searchAndPrice(game, query, parseCardLanguages(languages));
    const response = { matches: result.matches } satisfies PricingSearchResponse;
    pricingLogger(c).info(
      { event: 'pricing.search.completed', outcome: 'success', result_count: response.matches.length, game },
      'Completed a card pricing search.',
    );

    return c.json(response, { status: CONTENTFUL_STATUS_CODES.OK });
  },
});

export default searchPricingRoute;
