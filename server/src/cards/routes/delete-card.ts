import { createRoute, defineOpenAPIRoute } from '@kamaalio/hono-standard-openapi';

import { requireSessionMiddleware } from '../../auth/module.ts';
import { APP_API_ROUTE_NAME } from '../../constants/common.ts';
import { CONTENTFUL_STATUS_CODES } from '../../constants/http.ts';
import { MIME_TYPES } from '../../constants/request.ts';
import type { HonoEnvironment } from '../../context.ts';
import { CardNotFoundErrorResponseSchema, ErrorResponseSchema } from '../../schemas/errors.ts';
import { CARDS_OPENAPI_TAG, CARDS_ROUTE_NAME } from '../constants.ts';
import { CardNotFound } from '../exceptions.ts';
import { cardsLogger } from '../logging.ts';
import { CardIdParamsSchema } from '../schemas/params.ts';
import { DeleteCardResponseSchema } from '../schemas/responses.ts';

const DELETE_CARD_PATH = '/{cardId}';

const routeConfig = createRoute({
  method: 'delete',
  path: DELETE_CARD_PATH,
  tags: [CARDS_OPENAPI_TAG],
  summary: 'Delete an owned card',
  description: "Delete an owned card entry from the authenticated user's collection.",
  middleware: [requireSessionMiddleware] as const,
  security: [{ bearerAuth: [] }],
  request: { params: CardIdParamsSchema },
  responses: {
    [CONTENTFUL_STATUS_CODES.OK]: {
      description: 'Card deleted successfully',
      content: { [MIME_TYPES.JSON]: { schema: DeleteCardResponseSchema } },
    },
    [CONTENTFUL_STATUS_CODES.UNAUTHORIZED]: {
      description: 'Authenticated session not found',
      content: { [MIME_TYPES.JSON]: { schema: ErrorResponseSchema } },
    },
    [CONTENTFUL_STATUS_CODES.NOT_FOUND]: {
      description: 'Card not found or not owned by the authenticated user',
      content: { [MIME_TYPES.JSON]: { schema: CardNotFoundErrorResponseSchema } },
    },
  },
});

export const DELETE_CARD_ROUTE_PATH = `${APP_API_ROUTE_NAME}${CARDS_ROUTE_NAME}${routeConfig.path}` as const;

const deleteCardRoute = defineOpenAPIRoute<HonoEnvironment, typeof routeConfig>({
  route: routeConfig,
  handler: async c => {
    const { cardId } = c.req.valid('param');
    const deleted = await c.get('cardRepository').delete(cardId);

    if (!deleted) {
      cardsLogger(c).warn(
        { event: 'cards.access_denied', outcome: 'failure', error_code: 'CARD_NOT_FOUND', card_id: cardId },
        'Card not found or not owned by the authenticated user.',
      );
      throw new CardNotFound(c);
    }

    cardsLogger(c).info(
      { event: 'cards.delete', outcome: 'success', card_id: cardId },
      'Deleted an owned card from the collection.',
    );

    return c.json({}, { status: CONTENTFUL_STATUS_CODES.OK });
  },
});

export default deleteCardRoute;
