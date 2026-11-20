import { createRoute, defineOpenAPIRoute } from '@kamaalio/hono-standard-openapi';
import { MIME_TYPES } from '@tcg/http/mime';
import { CONTENTFUL_STATUS_CODES } from '@tcg/http/status';

import { serializeCardListPage } from '../../cards/list-page.ts';
import type { HonoEnvironment } from '../../context.ts';
import { displayPricedCard } from '../../forex/display.ts';
import { logDisplayPrices } from '../../forex/logging.ts';
import { authenticated, invalid, unauthorized } from '../route-dependencies.ts';
import { WishlistQuerySchema } from '../schemas/params.ts';
import { WishlistPageSchema } from '../schemas/responses.ts';

const routeConfig = createRoute({
  ...authenticated,
  method: 'get',
  path: '/',
  summary: 'List saved wishlist printings',
  request: { query: WishlistQuerySchema },
  responses: {
    [CONTENTFUL_STATUS_CODES.BAD_REQUEST]: invalid,
    [CONTENTFUL_STATUS_CODES.UNAUTHORIZED]: unauthorized,
    [CONTENTFUL_STATUS_CODES.OK]: {
      description: 'Page of saved printings',
      content: {
        [MIME_TYPES.JSON]: {
          schema: WishlistPageSchema,
        },
      },
    },
  },
});

const listWishlistRoute = defineOpenAPIRoute<HonoEnvironment, typeof routeConfig>({
  route: routeConfig,
  handler: async c => {
    const { entries: savedEntries, ...pageInfo } = await c
      .get('wishlistRepository')
      .list(c.req.valid('query'), c.get('config').PUBLIC_BASE_URL);

    const prices = await c.get('cardPricingService').priceWishlistEntries(savedEntries);

    if (prices.size === 0) {
      return c.json(
        serializeCardListPage(
          savedEntries.map(({ card }) => card),
          pageInfo,
        ),
        CONTENTFUL_STATUS_CODES.OK,
      );
    }

    const display = await c.get('forexService').displayContext();

    if (display.isErr()) {
      throw display.error;
    }

    const entries = savedEntries.map(({ card }) => {
      const price = prices.get(card.printing_key);

      if (price == null) {
        return card;
      }

      return displayPricedCard(
        {
          ...card,
          headline: price.headline,
          market: price.market,
          condition_prices: price.condition_prices,
          condition_values: price.condition_values,
          priced_on: price.priced_on,
          fetched_at: price.fetched_at,
        },
        display.value,
      );
    });

    logDisplayPrices(c, display.value, entries);

    return c.json(serializeCardListPage(entries, pageInfo), CONTENTFUL_STATUS_CODES.OK);
  },
});

export default listWishlistRoute;
