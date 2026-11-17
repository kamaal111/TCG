import { createRoute, defineOpenAPIRoute } from '@kamaalio/hono-standard-openapi';
import { ErrorResponseSchema } from '@tcg/http/error-schemas';
import { MIME_TYPES } from '@tcg/http/mime';
import { CONTENTFUL_STATUS_CODES, CONTENTLESS_STATUS_CODES } from '@tcg/http/status';

import type { HonoEnvironment } from '../../context.ts';
import { WishlistPricingRecordNotFound } from '../exceptions.ts';
import { authenticated, invalid, unauthorized } from '../route-dependencies.ts';
import { SaveWishlistPrintingSchema } from '../schemas/payloads.ts';

const routeConfig = createRoute({
  ...authenticated,
  method: 'post',
  path: '/',
  summary: 'Save a printing to the wishlist',
  request: {
    body: {
      required: true,
      content: { [MIME_TYPES.JSON]: { schema: SaveWishlistPrintingSchema } },
    },
  },
  responses: {
    [CONTENTFUL_STATUS_CODES.BAD_REQUEST]: invalid,
    [CONTENTFUL_STATUS_CODES.UNAUTHORIZED]: unauthorized,
    [CONTENTLESS_STATUS_CODES.NO_CONTENT]: { description: 'Printing saved or already present' },
    [CONTENTFUL_STATUS_CODES.NOT_FOUND]: {
      description: 'Pricing record not found',
      content: { [MIME_TYPES.JSON]: { schema: ErrorResponseSchema } },
    },
  },
});

const saveWishlistPrintingRoute = defineOpenAPIRoute<HonoEnvironment, typeof routeConfig>({
  route: routeConfig,
  handler: async c => {
    if (!(await c.get('wishlistRepository').save(c.req.valid('json').priced_card_id))) {
      throw new WishlistPricingRecordNotFound(c);
    }

    return c.body(null, CONTENTLESS_STATUS_CODES.NO_CONTENT);
  },
});

export default saveWishlistPrintingRoute;
