import { createRoute, defineOpenAPIRoute } from '@kamaalio/hono-standard-openapi';

import { CONTENTFUL_STATUS_CODES } from '../../constants/http.ts';
import { MIME_TYPES } from '../../constants/request.ts';
import type { HonoEnvironment } from '../../context.ts';
import { collectionsLogger } from '../logging.ts';
import type { CollectionRouteDependencies } from '../route-dependencies.ts';
import { CollectionParamsSchema } from '../schemas/params.ts';
import { CollectionSchema } from '../schemas/responses.ts';

export function createSaveLayoutRoute({ common, errors, schemas }: CollectionRouteDependencies) {
  const routeConfig = createRoute({
    ...common,
    method: 'put',
    path: '/{collectionId}/layout',
    summary: 'Replace a binder layout atomically',
    request: { params: CollectionParamsSchema, body: { content: { [MIME_TYPES.JSON]: { schema: schemas.layout } } } },
    responses: {
      ...errors,
      [CONTENTFUL_STATUS_CODES.OK]: {
        description: 'Saved collection',
        content: { [MIME_TYPES.JSON]: { schema: CollectionSchema } },
      },
    },
  });

  return defineOpenAPIRoute<HonoEnvironment, typeof routeConfig>({
    route: routeConfig,
    handler: async c => {
      const result = await c.get('collectionRepository').save(c.req.valid('param').collectionId, c.req.valid('json'));
      collectionsLogger(c).info(
        { event: 'collections.layout', outcome: 'success', collection_id: result.id },
        'Saved a binder layout.',
      );

      return c.json(result, { status: CONTENTFUL_STATUS_CODES.OK });
    },
  });
}
