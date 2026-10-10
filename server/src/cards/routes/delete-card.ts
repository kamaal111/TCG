import { createRoute, defineOpenAPIRoute } from '@kamaalio/hono-standard-openapi';

import { requireSessionMiddleware } from '../../auth/module.ts';
import { CONTENTFUL_STATUS_CODES } from '../../constants/http.ts';
import { MIME_TYPES } from '../../constants/request.ts';
import type { HonoEnvironment } from '../../context.ts';
import { ErrorResponseSchema, ValidationErrorResponseSchema } from '../../schemas/errors.ts';
import { CARDS_OPENAPI_TAG } from '../constants.ts';
import { cardsLogger } from '../logging.ts';
import { DeleteCardsSchema } from '../schemas/payloads.ts';
import { DeleteCardsResponseSchema } from '../schemas/responses.ts';

const routeConfig = createRoute({
  method: 'delete',
  path: '/',
  tags: [CARDS_OPENAPI_TAG],
  summary: 'Delete owned cards',
  description:
    'Delete owned matches and report missing or inaccessible IDs without distinguishing ownership. Each response array follows request order with duplicates removed.',
  middleware: [requireSessionMiddleware] as const,
  security: [{ bearerAuth: [] }],
  request: { body: { content: { [MIME_TYPES.JSON]: { schema: DeleteCardsSchema } } } },
  responses: {
    [CONTENTFUL_STATUS_CODES.OK]: {
      description: 'Deletion completed, including partial success or empty input',
      content: { [MIME_TYPES.JSON]: { schema: DeleteCardsResponseSchema } },
    },
    [CONTENTFUL_STATUS_CODES.BAD_REQUEST]: {
      description: 'Invalid card IDs',
      content: { [MIME_TYPES.JSON]: { schema: ValidationErrorResponseSchema } },
    },
    [CONTENTFUL_STATUS_CODES.UNAUTHORIZED]: {
      description: 'Authenticated session not found',
      content: { [MIME_TYPES.JSON]: { schema: ErrorResponseSchema } },
    },
  },
});

const deleteCardRoute = defineOpenAPIRoute<HonoEnvironment, typeof routeConfig>({
  route: routeConfig,
  handler: async c => {
    const result = await c.get('cardRepository').delete(c.req.valid('json').card_ids);
    cardsLogger(c).info(
      {
        event: 'cards.delete',
        outcome: 'success',
        result_count: result.deleted_ids.length,
        not_found_count: result.not_found_ids.length,
      },
      'Completed deletion of owned cards.',
    );

    return c.json(result, { status: CONTENTFUL_STATUS_CODES.OK });
  },
});

export default deleteCardRoute;
