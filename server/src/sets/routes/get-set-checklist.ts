import { createRoute, defineOpenAPIRoute } from '@kamaalio/hono-standard-openapi';
import { MIME_TYPES } from '@tcg/http/mime';
import { CONTENTFUL_STATUS_CODES } from '@tcg/http/status';

import type { HonoEnvironment } from '../../context.ts';
import { authenticated, setErrorResponses } from '../route-dependencies.ts';
import { ChecklistQuerySchema, SetPathSchema } from '../schemas/params.ts';
import { ChecklistResponseSchema } from '../schemas/responses.ts';

const routeConfig = createRoute({
  ...authenticated,
  method: 'get',
  path: '/{game}/{set_id}/cards',
  operationId: 'getAppApiSetChecklist',
  summary: 'List set checklist cards',
  request: { params: SetPathSchema, query: ChecklistQuerySchema },
  responses: {
    ...setErrorResponses,
    [CONTENTFUL_STATUS_CODES.OK]: {
      description: 'Checklist page',
      content: { [MIME_TYPES.JSON]: { schema: ChecklistResponseSchema } },
    },
  },
});

const getSetChecklistRoute = defineOpenAPIRoute<HonoEnvironment, typeof routeConfig>({
  route: routeConfig,
  handler: async c => {
    const result = await c.get('setsService').checklist(c.req.valid('param'), c.req.valid('query'));

    return c.json(result, CONTENTFUL_STATUS_CODES.OK);
  },
});

export default getSetChecklistRoute;
