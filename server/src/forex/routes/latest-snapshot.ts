import { createRoute, defineOpenAPIRoute } from '@kamaalio/hono-standard-openapi';

import { requireSessionMiddleware } from '../../auth/module.ts';
import { APP_API_ROUTE_NAME } from '../../constants/common.ts';
import { CONTENTFUL_STATUS_CODES } from '../../constants/http.ts';
import { MIME_TYPES } from '../../constants/request.ts';
import type { HonoEnvironment } from '../../context.ts';
import { ErrorResponseSchema } from '../../schemas/errors.ts';
import { FOREX_OPENAPI_TAG, FOREX_ROUTE_NAME } from '../constants.ts';
import { ForexSnapshotSchema } from '../schemas/responses.ts';

export const LATEST_SNAPSHOT_ROUTE_PATH = `${APP_API_ROUTE_NAME}${FOREX_ROUTE_NAME}/latest` as const;

const routeConfig = createRoute({
  method: 'get',
  path: '/latest',
  tags: [FOREX_OPENAPI_TAG],
  summary: 'Get latest daily exchange rates',
  middleware: [requireSessionMiddleware] as const,
  security: [{ bearerAuth: [] }],
  responses: {
    [CONTENTFUL_STATUS_CODES.OK]: {
      description: 'Latest EUR-based exchange rates',
      content: { [MIME_TYPES.JSON]: { schema: ForexSnapshotSchema } },
    },
    [CONTENTFUL_STATUS_CODES.UNAUTHORIZED]: {
      description: 'Unauthenticated',
      content: { [MIME_TYPES.JSON]: { schema: ErrorResponseSchema } },
    },
    [CONTENTFUL_STATUS_CODES.SERVICE_UNAVAILABLE]: {
      description: 'No rates collected yet',
      content: { [MIME_TYPES.JSON]: { schema: ErrorResponseSchema } },
    },
  },
});

const latestSnapshotRoute = defineOpenAPIRoute<HonoEnvironment, typeof routeConfig>({
  route: routeConfig,
  handler: async c => {
    const snapshot = await c.get('forexService').latestSnapshot();

    return c.json(snapshot, { status: CONTENTFUL_STATUS_CODES.OK });
  },
});

export default latestSnapshotRoute;
