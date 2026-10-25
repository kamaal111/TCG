import { createRoute, defineOpenAPIRoute } from '@kamaalio/hono-standard-openapi';

import { CONTENTFUL_STATUS_CODES } from '../../constants/http.ts';
import { MIME_TYPES } from '../../constants/request.ts';
import type { HonoEnvironment } from '../../context.ts';
import type { CollectionRouteDependencies } from '../route-dependencies.ts';
import { BackupPreviewSchema } from '../schemas/responses.ts';

export function createPreviewImportRoute({ common, errors, schemas }: CollectionRouteDependencies) {
  const routeConfig = createRoute({
    ...common,
    method: 'post',
    path: '/import-preview',
    summary: 'Review a collection backup without importing it',
    request: { body: { content: { [MIME_TYPES.JSON]: { schema: schemas.backup } } } },
    responses: {
      ...errors,
      [CONTENTFUL_STATUS_CODES.OK]: {
        description: 'Planned import changes',
        content: { [MIME_TYPES.JSON]: { schema: BackupPreviewSchema } },
      },
    },
  });

  return defineOpenAPIRoute<HonoEnvironment, typeof routeConfig>({
    route: routeConfig,
    handler: async c =>
      c.json(await c.get('collectionRepository').preview(c.req.valid('json')), { status: CONTENTFUL_STATUS_CODES.OK }),
  });
}
