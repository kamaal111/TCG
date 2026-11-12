import { createRoute, defineOpenAPIRoute } from '@kamaalio/hono-standard-openapi';
import { MIME_TYPES } from '@tcg/http/mime';
import { CONTENTFUL_STATUS_CODES, CONTENTLESS_STATUS_CODES } from '@tcg/http/status';

import { getSession } from '../../auth/module.ts';
import { OWNED_CARD_PRICE_STATUSES } from '../../card-pricing/schemas/responses.ts';
import type { HonoEnvironment } from '../../context.ts';
import { authenticated, unauthorized } from '../offline-route-dependencies.ts';
import {
  ManifestSchema,
  OfflineManifestETagHeadersSchema,
  OfflineManifestRequestHeadersSchema,
} from '../schemas/offline-collection.ts';
import { hashOfflineRecord, offlineEntriesFor, readOfflineRecords } from '../utils/offline-collection.ts';

const routeConfig = createRoute({
  ...authenticated,
  method: 'get',
  path: '/offline/manifest',
  operationId: 'getOfflineCollectionManifest',
  summary: 'Check for offline collection changes',
  description:
    'List the authenticated account’s downloadable cards and collection layouts. Use the manifest to request changed records and identify local deletions.',
  request: { headers: OfflineManifestRequestHeadersSchema },
  responses: {
    [CONTENTFUL_STATUS_CODES.OK]: {
      description: 'Current collection manifest',
      headers: OfflineManifestETagHeadersSchema,
      content: { [MIME_TYPES.JSON]: { schema: ManifestSchema } },
    },
    [CONTENTLESS_STATUS_CODES.NOT_MODIFIED]: {
      description: 'Collection has not changed',
      headers: OfflineManifestETagHeadersSchema,
    },
    [CONTENTFUL_STATUS_CODES.UNAUTHORIZED]: unauthorized,
  },
});

const getOfflineManifestRoute = defineOpenAPIRoute<HonoEnvironment, typeof routeConfig>({
  route: routeConfig,
  handler: async c => {
    const records = await readOfflineRecords(c, undefined);

    const manifest = {
      version: 1 as const,
      account_id: getSession(c).user.id,
      entries: offlineEntriesFor(records),
      needs_preparation: records.cards
        .flatMap(card => (card.price.status === OWNED_CARD_PRICE_STATUSES.UNAVAILABLE ? [card.id] : []))
        .sort(),
    };

    const etag = `"${hashOfflineRecord(manifest)}"`;
    c.header('ETag', `W/${etag}`);
    c.header('Cache-Control', 'private, no-store');
    const validators = c.req.valid('header')['if-none-match']?.split(',') ?? [];

    if (validators.some(validator => ['*', etag].includes(validator.trim().replace(/^W\//, '')))) {
      return c.body(null, CONTENTLESS_STATUS_CODES.NOT_MODIFIED);
    }

    return c.json(manifest, CONTENTFUL_STATUS_CODES.OK);
  },
});

export default getOfflineManifestRoute;
