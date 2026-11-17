import { createRoute, defineOpenAPIRoute } from '@kamaalio/hono-standard-openapi';
import { CONTENTFUL_STATUS_CODES, CONTENTLESS_STATUS_CODES } from '@tcg/http/status';

import type { HonoEnvironment } from '../../context.ts';
import { authenticated, invalid, unauthorized } from '../route-dependencies.ts';
import { WishlistPrintingParamsSchema } from '../schemas/params.ts';

const routeConfig = createRoute({
  ...authenticated,
  method: 'delete',
  path: '/{printingKey}',
  summary: 'Remove a printing from the wishlist',
  request: { params: WishlistPrintingParamsSchema },
  responses: {
    [CONTENTFUL_STATUS_CODES.BAD_REQUEST]: invalid,
    [CONTENTFUL_STATUS_CODES.UNAUTHORIZED]: unauthorized,
    [CONTENTLESS_STATUS_CODES.NO_CONTENT]: { description: 'Printing removed or already absent' },
  },
});

const removeWishlistPrintingRoute = defineOpenAPIRoute<HonoEnvironment, typeof routeConfig>({
  route: routeConfig,
  handler: async c => {
    await c.get('wishlistRepository').remove(c.req.valid('param').printingKey);

    return c.body(null, CONTENTLESS_STATUS_CODES.NO_CONTENT);
  },
});

export default removeWishlistPrintingRoute;
