import { createRoute, defineOpenAPIRoute } from '@kamaalio/hono-standard-openapi';
import { MIME_TYPES } from '@tcg/http/mime';
import { CONTENTFUL_STATUS_CODES } from '@tcg/http/status';

import { serializeOwnedCardDetails } from '../../cards/utils/cards.ts';
import type { HonoEnvironment } from '../../context.ts';
import type { CollectionRouteDependencies } from '../route-dependencies.ts';
import { PageParamsSchema } from '../schemas/params.ts';
import { BinderPageCardsSchema } from '../schemas/responses.ts';

export function createGetPageRoute({ common, errors }: CollectionRouteDependencies) {
  const routeConfig = createRoute({
    ...common,
    method: 'get',
    path: '/{collectionId}/pages/{pageId}',
    summary: 'Get binder page cards',
    request: { params: PageParamsSchema },
    responses: {
      ...errors,
      [CONTENTFUL_STATUS_CODES.OK]: {
        description: 'Page with card details',
        content: {
          [MIME_TYPES.JSON]: {
            schema: BinderPageCardsSchema,
          },
        },
      },
    },
  });

  return defineOpenAPIRoute<HonoEnvironment, typeof routeConfig>({
    route: routeConfig,
    handler: async c => {
      const { collectionId, pageId } = c.req.valid('param');
      const result = await c.get('collectionRepository').page(collectionId, pageId);
      const cards = await serializeOwnedCardDetails(c, result.cards);

      return c.json({ cards }, { status: CONTENTFUL_STATUS_CODES.OK });
    },
  });
}
