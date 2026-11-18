import { createRoute, defineOpenAPIRoute } from '@kamaalio/hono-standard-openapi';
import { MIME_TYPES } from '@tcg/http/mime';
import { CONTENTFUL_STATUS_CODES } from '@tcg/http/status';

import type { HonoEnvironment } from '../../context.ts';
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
    const { cursor, query } = c.req.valid('query');
    const result = await c.get('wishlistRepository').list(cursor, c.get('config').PUBLIC_BASE_URL, query);

    return c.json(result, CONTENTFUL_STATUS_CODES.OK);
  },
});

export default listWishlistRoute;
