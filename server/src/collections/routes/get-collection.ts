import { createRoute, defineOpenAPIRoute } from '@kamaalio/hono-standard-openapi';

import { CONTENTFUL_STATUS_CODES } from '../../constants/http.ts';
import { MIME_TYPES } from '../../constants/request.ts';
import type { HonoEnvironment } from '../../context.ts';
import type { CollectionRouteDependencies } from '../route-dependencies.ts';
import { CollectionParamsSchema } from '../schemas/params.ts';
import { CollectionSchema } from '../schemas/responses.ts';

export function createGetCollectionRoute({ common, errors }: CollectionRouteDependencies) {
  const routeConfig = createRoute({
    ...common,
    method: 'get',
    path: '/{collectionId}',
    summary: 'Get one collection and its binder layout',
    request: { params: CollectionParamsSchema },
    responses: {
      ...errors,
      [CONTENTFUL_STATUS_CODES.OK]: {
        description: 'Collection and binder layout',
        content: { [MIME_TYPES.JSON]: { schema: CollectionSchema } },
      },
    },
  });

  return defineOpenAPIRoute<HonoEnvironment, typeof routeConfig>({
    route: routeConfig,
    handler: async c =>
      c.json(await c.get('collectionRepository').get(c.req.valid('param').collectionId), {
        status: CONTENTFUL_STATUS_CODES.OK,
      }),
  });
}
