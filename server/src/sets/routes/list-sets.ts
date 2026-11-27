import { createRoute, defineOpenAPIRoute } from '@kamaalio/hono-standard-openapi';
import { MIME_TYPES } from '@tcg/http/mime';
import { CONTENTFUL_STATUS_CODES } from '@tcg/http/status';

import type { HonoEnvironment } from '../../context.ts';
import { authenticated, setErrorResponses } from '../route-dependencies.ts';
import { SetListQuerySchema } from '../schemas/params.ts';
import { SetListResponseSchema } from '../schemas/responses.ts';

const routeConfig = createRoute({
  ...authenticated,
  method: 'get',
  path: '/',
  operationId: 'getAppApiSets',
  summary: 'List sets',
  request: { query: SetListQuerySchema },
  responses: {
    ...setErrorResponses,
    [CONTENTFUL_STATUS_CODES.OK]: {
      description: 'Matching sets',
      content: { [MIME_TYPES.JSON]: { schema: SetListResponseSchema } },
    },
  },
});

const listSetsRoute = defineOpenAPIRoute<HonoEnvironment, typeof routeConfig>({
  route: routeConfig,
  handler: async c => {
    const result = await c.get('setsService').list(c.req.valid('query'));

    return c.json(result, CONTENTFUL_STATUS_CODES.OK);
  },
});

export default listSetsRoute;
