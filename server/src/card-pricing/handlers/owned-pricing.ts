import type { TypedResponse } from 'hono';

import { APP_API_ROUTE_NAME } from '../../constants/common.ts';
import { STATUS_CODES } from '../../constants/http.ts';
import type { HonoContext } from '../../context.ts';
import { withRequestLogger } from '../../logging/http.ts';
import { logInfo } from '../../logging/index.ts';
import { PRICING_ROUTE_NAME } from '../constants.ts';
import { OwnedPricingResponseSchema, type OwnedPricingResponse } from '../schemas/responses.ts';
import { CardPricingService } from '../service.ts';
import type { OwnedPricingQuerySchema } from '../schemas/params.ts';
import type { z } from '@hono/zod-openapi';

export const OWNED_PRICING_ROUTE_PATH = `${APP_API_ROUTE_NAME}${PRICING_ROUTE_NAME}/owned` as const;
type OwnedPricingContext = HonoContext<
  typeof OWNED_PRICING_ROUTE_PATH,
  { out: { query: z.infer<typeof OwnedPricingQuerySchema> } }
>;

async function ownedPricingHandler(
  c: OwnedPricingContext,
): Promise<TypedResponse<OwnedPricingResponse, typeof STATUS_CODES.OK>> {
  const { game } = c.req.valid('query');
  const response = OwnedPricingResponseSchema.parse({
    prices: await CardPricingService.ownedPrices(c, game),
  });
  logInfo(
    withRequestLogger(c, { component: 'card-pricing' }),
    {
      event: 'pricing.owned.completed',
      route: OWNED_PRICING_ROUTE_PATH,
      outcome: 'success',
      result_count: response.prices.length,
      game,
    },
    'Retrieved pricing for the owned card collection.',
  );

  return c.json(response, { status: STATUS_CODES.OK });
}

export default ownedPricingHandler;
