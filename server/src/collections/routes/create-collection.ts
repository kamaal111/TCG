import { createRoute, defineOpenAPIRoute } from '@kamaalio/hono-standard-openapi';

import { CONTENTFUL_STATUS_CODES } from '../../constants/http.ts';
import { MIME_TYPES } from '../../constants/request.ts';
import type { HonoEnvironment } from '../../context.ts';
import { collectionsLogger } from '../logging.ts';
import type { CollectionRouteDependencies } from '../route-dependencies.ts';
import { CreateCollectionSchema } from '../schemas/payloads.ts';
import { CollectionSchema } from '../schemas/responses.ts';

export function createCollectionRoute({ common, errors }: CollectionRouteDependencies) {
  const routeConfig = createRoute({
    ...common,
    method: 'post',
    path: '/',
    summary: 'Create a collection',
    request: { body: { content: { [MIME_TYPES.JSON]: { schema: CreateCollectionSchema } } } },
    responses: {
      ...errors,
      [CONTENTFUL_STATUS_CODES.CREATED]: {
        description: 'Created collection',
        content: { [MIME_TYPES.JSON]: { schema: CollectionSchema } },
      },
    },
  });

  return defineOpenAPIRoute<HonoEnvironment, typeof routeConfig>({
    route: routeConfig,
    handler: async c => {
      const result = await c.get('collectionRepository').create(c.req.valid('json').name);
      collectionsLogger(c).info(
        { event: 'collections.create', outcome: 'success', collection_id: result.id },
        'Created a card collection.',
      );

      return c.json(result, { status: CONTENTFUL_STATUS_CODES.CREATED });
    },
  });
}
