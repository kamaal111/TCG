import { createRoute, defineOpenAPIRoute } from '@kamaalio/hono-standard-openapi';

import { CONTENTFUL_STATUS_CODES } from '../../constants/http.ts';
import { MIME_TYPES } from '../../constants/request.ts';
import type { HonoEnvironment } from '../../context.ts';
import { collectionsLogger } from '../logging.ts';
import type { CollectionRouteDependencies } from '../route-dependencies.ts';
import { CollectionParamsSchema } from '../schemas/params.ts';
import { UpdateCollectionSchema } from '../schemas/payloads.ts';
import { CollectionSchema } from '../schemas/responses.ts';

export function createUpdateCollectionRoute({ common, errors }: CollectionRouteDependencies) {
  const routeConfig = createRoute({
    ...common,
    method: 'patch',
    path: '/{collectionId}',
    summary: 'Rename a collection',
    request: {
      params: CollectionParamsSchema,
      body: { content: { [MIME_TYPES.JSON]: { schema: UpdateCollectionSchema } } },
    },
    responses: {
      ...errors,
      [CONTENTFUL_STATUS_CODES.OK]: {
        description: 'Updated collection',
        content: { [MIME_TYPES.JSON]: { schema: CollectionSchema } },
      },
    },
  });

  return defineOpenAPIRoute<HonoEnvironment, typeof routeConfig>({
    route: routeConfig,
    handler: async c => {
      const result = await c.get('collectionRepository').update(c.req.valid('param').collectionId, c.req.valid('json'));

      collectionsLogger(c).info(
        { event: 'collections.update', outcome: 'success', collection_id: result.id },
        'Updated collection settings.',
      );

      return c.json(result, { status: CONTENTFUL_STATUS_CODES.OK });
    },
  });
}
