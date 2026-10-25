import { createRoute, defineOpenAPIRoute } from '@kamaalio/hono-standard-openapi';

import { CONTENTFUL_STATUS_CODES } from '../../constants/http.ts';
import { MIME_TYPES } from '../../constants/request.ts';
import type { HonoEnvironment } from '../../context.ts';
import { collectionBackupStream, CollectionBackupResponse } from '../backup-stream.ts';
import { collectionsLogger } from '../logging.ts';
import type { CollectionRouteDependencies } from '../route-dependencies.ts';
import { BackupSchema } from '../schemas/responses.ts';

export function createExportCollectionsRoute({ common, errors, schemas, policy }: CollectionRouteDependencies) {
  const routeConfig = createRoute({
    ...common,
    method: 'post',
    path: '/export',
    summary: 'Export selected collections or all collections',
    request: { body: { content: { [MIME_TYPES.JSON]: { schema: schemas.export } } } },
    responses: {
      ...errors,
      [CONTENTFUL_STATUS_CODES.OK]: {
        description: 'Complete backup',
        content: { [MIME_TYPES.JSON]: { schema: BackupSchema } },
      },
    },
  });

  return defineOpenAPIRoute<HonoEnvironment, typeof routeConfig>({
    route: routeConfig,
    handler: async c => {
      const body = await collectionBackupStream({
        produce: async writer => {
          await c.get('collectionRepository').exportTo(writer, c.req.valid('json').collection_ids);
        },
        completed: () => {
          collectionsLogger(c).info(
            { event: 'collections.export', outcome: 'success' },
            'Exported complete collections.',
          );
        },
        failed: error => {
          collectionsLogger(c).error(
            { event: 'collections.export', outcome: 'failure', err: error },
            'Collection export was interrupted.',
          );
        },
        signal: c.req.raw.signal,
        timeoutMs: policy.COLLECTION_OPERATION_TIMEOUT_MS,
      });

      return new CollectionBackupResponse(body);
    },
  });
}
