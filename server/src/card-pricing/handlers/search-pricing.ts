import type { TypedResponse } from 'hono';

import { APP_API_ROUTE_NAME } from '../../constants/common.ts';
import { STATUS_CODES } from '../../constants/http.ts';
import type { HonoContext } from '../../context.ts';
import { PRICING_ROUTE_NAME } from '../constants.ts';
import { pricingLogger } from '../logging.ts';
import type { PricingSearchQuery } from '../schemas/params.ts';
import type { PricingSearchResponse } from '../schemas/responses.ts';

export const SEARCH_PRICING_ROUTE_PATH = `${APP_API_ROUTE_NAME}${PRICING_ROUTE_NAME}/search` as const;

type SearchPricingContext = HonoContext<typeof SEARCH_PRICING_ROUTE_PATH, { out: { query: PricingSearchQuery } }>;

async function searchPricingHandler(
  c: SearchPricingContext,
): Promise<TypedResponse<PricingSearchResponse, typeof STATUS_CODES.OK>> {
  const { game, query } = c.req.valid('query');
  const result = await c.get('cardPricingService').searchAndPrice(game, query);
  const response = { matches: result.matches } satisfies PricingSearchResponse;
  pricingLogger(c).info(
    { event: 'pricing.search.completed', outcome: 'success', result_count: response.matches.length, game },
    'Completed a card pricing search.',
  );

  return c.json(response, { status: STATUS_CODES.OK });
}

export default searchPricingHandler;
