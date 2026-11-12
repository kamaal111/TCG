import { createRoute, defineOpenAPIRoute } from '@kamaalio/hono-standard-openapi';
import { ErrorResponseSchema } from '@tcg/http/error-schemas';
import { MIME_TYPES } from '@tcg/http/mime';
import { CONTENTFUL_STATUS_CODES } from '@tcg/http/status';

import type { HonoEnvironment } from '../../context.ts';
import { OfflineCollectionConflict } from '../exceptions.ts';
import type { OfflineCollectionIDs } from '../offline-collection-repository.ts';
import { authenticated, invalid, unauthorized } from '../offline-route-dependencies.ts';
import { OfflineRecordsRequestSchema, RecordsSchema } from '../schemas/offline-collection.ts';
import { offlineEntriesFor, readOfflineRecords } from '../utils/offline-collection.ts';

const routeConfig = createRoute({
  ...authenticated,
  method: 'post',
  path: '/offline/records',
  operationId: 'getOfflineCollectionRecords',
  summary: 'Download selected offline collection records',
  description:
    'Fetch records for selected manifest entries. If any entry is stale or unavailable to this account, refresh the manifest and retry the batch.',
  request: {
    body: {
      content: {
        [MIME_TYPES.JSON]: { schema: OfflineRecordsRequestSchema },
      },
    },
  },
  responses: {
    [CONTENTFUL_STATUS_CODES.OK]: {
      description: 'Requested collection records',
      content: { [MIME_TYPES.JSON]: { schema: RecordsSchema } },
    },
    [CONTENTFUL_STATUS_CODES.BAD_REQUEST]: invalid,
    [CONTENTFUL_STATUS_CODES.UNAUTHORIZED]: unauthorized,
    [CONTENTFUL_STATUS_CODES.CONFLICT]: {
      description: 'A requested record differs from the manifest',
      content: { [MIME_TYPES.JSON]: { schema: ErrorResponseSchema } },
    },
  },
});

const getOfflineRecordsRoute = defineOpenAPIRoute<HonoEnvironment, typeof routeConfig>({
  route: routeConfig,
  handler: async c => {
    const { entries } = c.req.valid('json');
    const ids: OfflineCollectionIDs = { cards: [], collections: [] };

    for (const entry of entries) {
      (entry.kind === 'card' ? ids.cards : ids.collections).push(entry.id);
    }

    const records = await readOfflineRecords(c, ids);
    const hashes = new Map(offlineEntriesFor(records).map(entry => [`${entry.kind}/${entry.id}`, entry.hash]));

    if (entries.some(entry => hashes.get(`${entry.kind}/${entry.id}`) !== entry.hash)) {
      throw new OfflineCollectionConflict();
    }

    c.header('Cache-Control', 'private, no-store');

    return c.json(records, CONTENTFUL_STATUS_CODES.OK);
  },
});

export default getOfflineRecordsRoute;
