import { createRoute, defineOpenAPIRoute } from '@kamaalio/hono-standard-openapi';

import { CONTENTFUL_STATUS_CODES } from '../../constants/http.ts';
import { MIME_TYPES } from '../../constants/request.ts';
import type { HonoEnvironment } from '../../context.ts';
import { collectionsLogger } from '../logging.ts';
import type { CollectionRouteDependencies } from '../route-dependencies.ts';
import { ImportBackupResponseSchema } from '../schemas/responses.ts';

export function createImportCollectionsRoute({ common, errors, schemas }: CollectionRouteDependencies) {
  const routeConfig = createRoute({
    ...common,
    method: 'post',
    path: '/import',
    summary: 'Merge a complete collection backup atomically',
    request: { body: { content: { [MIME_TYPES.JSON]: { schema: schemas.backup } } } },
    responses: {
      ...errors,
      [CONTENTFUL_STATUS_CODES.OK]: {
        description: 'Import result',
        content: { [MIME_TYPES.JSON]: { schema: ImportBackupResponseSchema } },
      },
    },
  });

  return defineOpenAPIRoute<HonoEnvironment, typeof routeConfig>({
    route: routeConfig,
    handler: async c => {
      const result = await c.get('collectionRepository').import(c.req.valid('json'));
      collectionsLogger(c).info(
        { event: 'collections.import', outcome: 'success', result_count: result.collection_count },
        'Committed a complete collection import.',
      );

      return c.json(result, { status: CONTENTFUL_STATUS_CODES.OK });
    },
  });
}
