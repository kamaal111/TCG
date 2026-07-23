import type { TypedResponse } from 'hono';

import { APP_API_ROUTE_NAME } from '../../constants/common.ts';
import { STATUS_CODES } from '../../constants/http.ts';
import type { HonoContext } from '../../context.ts';
import { withRequestLogger } from '../../logging/http.ts';
import { logInfo } from '../../logging/index.ts';
import { PRICING_ROUTE_NAME } from '../constants.ts';
import { PricingSearchResponseSchema, type PricingSearchResponse } from '../schemas/responses.ts';
import { CardPricingService } from '../service.ts';
import type { PricingSearchQuerySchema } from '../schemas/params.ts';
import type { z } from '@hono/zod-openapi';

export const SEARCH_PRICING_ROUTE_PATH = `${APP_API_ROUTE_NAME}${PRICING_ROUTE_NAME}/search` as const;
type SearchPricingContext = HonoContext<
  typeof SEARCH_PRICING_ROUTE_PATH,
  { out: { query: z.infer<typeof PricingSearchQuerySchema> } }
>;

async function searchPricingHandler(
  c: SearchPricingContext,
): Promise<TypedResponse<PricingSearchResponse, typeof STATUS_CODES.OK>> {
  const { game, query } = c.req.valid('query');
  const result = await CardPricingService.searchAndPrice(c, game, query);
  const response = PricingSearchResponseSchema.parse({
    query,
    normalized_query: result.normalizedQuery,
    game,
    status: result.matches.length === 0 ? 'no_results' : 'ok',
    matches: result.matches,
  });
  logInfo(
    withRequestLogger(c, { component: 'card-pricing' }),
    {
      event: 'pricing.search.completed',
      route: SEARCH_PRICING_ROUTE_PATH,
      outcome: 'success',
      result_count: response.matches.length,
      game,
    },
    'Completed a card pricing search.',
  );

  return c.json(response, { status: STATUS_CODES.OK });
}

export default searchPricingHandler;
