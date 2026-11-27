import { createRoute, defineOpenAPIRoute } from '@kamaalio/hono-standard-openapi';
import { MIME_TYPES } from '@tcg/http/mime';
import { CONTENTFUL_STATUS_CODES } from '@tcg/http/status';

import type { HonoEnvironment } from '../../context.ts';
import { authenticated, setErrorResponses } from '../route-dependencies.ts';
import { SetCardPathSchema } from '../schemas/params.ts';
import { SetCardDetailResponseSchema } from '../schemas/responses.ts';

const routeConfig = createRoute({
  ...authenticated,
  method: 'get',
  path: '/{game}/{set_id}/cards/{number}',
  operationId: 'getAppApiSetCardDetail',
  summary: 'Price a set checklist card',
  request: { params: SetCardPathSchema },
  responses: {
    ...setErrorResponses,
    [CONTENTFUL_STATUS_CODES.OK]: {
      description: 'Priced printings for a checklist slot',
      content: { [MIME_TYPES.JSON]: { schema: SetCardDetailResponseSchema } },
    },
  },
});

const getSetCardDetailRoute = defineOpenAPIRoute<HonoEnvironment, typeof routeConfig>({
  route: routeConfig,
  handler: async c => {
    const result = await c.get('setsService').cardDetail(c.req.valid('param'));

    return c.json(result, CONTENTFUL_STATUS_CODES.OK);
  },
});

export default getSetCardDetailRoute;
