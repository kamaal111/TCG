import { createRoute, defineOpenAPIRoute } from '@kamaalio/hono-standard-openapi';
import { MIME_TYPES } from '@tcg/http/mime';
import { CONTENTFUL_STATUS_CODES } from '@tcg/http/status';

import type { HonoEnvironment } from '../../context.ts';
import type { CollectionRouteDependencies } from '../route-dependencies.ts';
import { CollectionsSchema } from '../schemas/responses.ts';

export function createListCollectionsRoute({ common, errors }: CollectionRouteDependencies) {
  const routeConfig = createRoute({
    ...common,
    method: 'get',
    path: '/',
    summary: 'List collections',
    responses: {
      ...errors,
      [CONTENTFUL_STATUS_CODES.OK]: {
        description: 'Collections',
        content: { [MIME_TYPES.JSON]: { schema: CollectionsSchema } },
      },
    },
  });

  return defineOpenAPIRoute<HonoEnvironment, typeof routeConfig>({
    route: routeConfig,
    handler: async c => {
      return c.json(
        { collections: await c.get('collectionRepository').list() },
        { status: CONTENTFUL_STATUS_CODES.OK },
      );
    },
  });
}
