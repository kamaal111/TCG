import { createRoute, defineOpenAPIRoute } from '@kamaalio/hono-standard-openapi';

import { requireSessionMiddleware } from '../../auth/module.ts';
import { APP_API_ROUTE_NAME } from '../../constants/common.ts';
import { CONTENTFUL_STATUS_CODES } from '../../constants/http.ts';
import { MIME_TYPES } from '../../constants/request.ts';
import type { HonoEnvironment } from '../../context.ts';
import { ErrorResponseSchema, ValidationErrorResponseSchema } from '../../schemas/errors.ts';
import { CARDS_OPENAPI_TAG, CARDS_ROUTE_NAME } from '../constants.ts';
import { ImportCardsSchema } from '../schemas/payloads.ts';
import { ImportCardsResponseSchema } from '../schemas/responses.ts';

const IMPORT_CARDS_PATH = '/import';

const routeConfig = createRoute({
  method: 'post',
  path: IMPORT_CARDS_PATH,
  tags: [CARDS_OPENAPI_TAG],
  summary: 'Import new cards and replace changed owned cards',
  description:
    "Import cards into the authenticated user's collection. Matching owned IDs replace changed cards and complete purchase history; unchanged cards are skipped.",
  middleware: [requireSessionMiddleware] as const,
  security: [{ bearerAuth: [] }],
  request: { body: { content: { [MIME_TYPES.JSON]: { schema: ImportCardsSchema } } } },
  responses: {
    [CONTENTFUL_STATUS_CODES.OK]: {
      description: 'Import completed',
      content: { [MIME_TYPES.JSON]: { schema: ImportCardsResponseSchema } },
    },
    [CONTENTFUL_STATUS_CODES.BAD_REQUEST]: {
      description: 'Invalid cards',
      content: { [MIME_TYPES.JSON]: { schema: ValidationErrorResponseSchema } },
    },
    [CONTENTFUL_STATUS_CODES.UNAUTHORIZED]: {
      description: 'Session not found',
      content: { [MIME_TYPES.JSON]: { schema: ErrorResponseSchema } },
    },
    [CONTENTFUL_STATUS_CODES.INTERNAL_SERVER_ERROR]: {
      description: 'Unexpected server failure',
      content: { [MIME_TYPES.JSON]: { schema: ErrorResponseSchema } },
    },
  },
});

export const IMPORT_CARDS_ROUTE_PATH = `${APP_API_ROUTE_NAME}${CARDS_ROUTE_NAME}${routeConfig.path}` as const;

const importCardsRoute = defineOpenAPIRoute<HonoEnvironment, typeof routeConfig>({
  route: routeConfig,
  handler: async c => {
    const response = await c.get('cardRepository').importCards(c.req.valid('json').cards);

    return c.json(response, { status: CONTENTFUL_STATUS_CODES.OK });
  },
});

export default importCardsRoute;
