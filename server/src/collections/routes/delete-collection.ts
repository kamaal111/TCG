import { createRoute, defineOpenAPIRoute } from '@kamaalio/hono-standard-openapi';

import { CONTENTFUL_STATUS_CODES } from '../../constants/http.ts';
import { MIME_TYPES } from '../../constants/request.ts';
import type { HonoEnvironment } from '../../context.ts';
import { collectionsLogger } from '../logging.ts';
import type { CollectionRouteDependencies } from '../route-dependencies.ts';
import { CollectionParamsSchema } from '../schemas/params.ts';
import { DeleteCollectionResponseSchema } from '../schemas/responses.ts';

export function createDeleteCollectionRoute({ common, errors }: CollectionRouteDependencies) {
  const routeConfig = createRoute({
    ...common,
    method: 'delete',
    path: '/{collectionId}',
    summary: 'Delete a collection and move its cards to Unfiled',
    request: { params: CollectionParamsSchema },
    responses: {
      ...errors,
      [CONTENTFUL_STATUS_CODES.OK]: {
        description: 'Deleted collection',
        content: {
          [MIME_TYPES.JSON]: { schema: DeleteCollectionResponseSchema },
        },
      },
    },
  });

  return defineOpenAPIRoute<HonoEnvironment, typeof routeConfig>({
    route: routeConfig,
    handler: async c => {
      const id = c.req.valid('param').collectionId;
      await c.get('collectionRepository').delete(id);
      collectionsLogger(c).info(
        { event: 'collections.delete', outcome: 'success', collection_id: id },
        'Deleted a collection and moved its cards to Unfiled.',
      );

      return c.json({ deleted: true }, { status: CONTENTFUL_STATUS_CODES.OK });
    },
  });
}
