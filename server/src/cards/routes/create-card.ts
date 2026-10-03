import { createRoute, defineOpenAPIRoute } from '@kamaalio/hono-standard-openapi';

import { requireSessionMiddleware } from '../../auth/module.ts';
import { APP_API_ROUTE_NAME } from '../../constants/common.ts';
import { CONTENTFUL_STATUS_CODES } from '../../constants/http.ts';
import { MIME_TYPES } from '../../constants/request.ts';
import type { HonoEnvironment } from '../../context.ts';
import { ErrorResponseSchema, ValidationErrorResponseSchema } from '../../schemas/errors.ts';
import { CARDS_OPENAPI_TAG, CARDS_ROUTE_NAME } from '../constants.ts';
import { cardsLogger } from '../logging.ts';
import { UpsertCardSchema } from '../schemas/payloads.ts';
import { CardWithPriceSchema } from '../schemas/responses.ts';
import { serializeCardWithPrice } from '../utils/cards.ts';

const CREATE_CARD_PATH = '/';

const routeConfig = createRoute({
  method: 'post',
  path: CREATE_CARD_PATH,
  tags: [CARDS_OPENAPI_TAG],
  summary: 'Add an owned card',
  description: "Add an owned trading card entry to the authenticated user's collection.",
  middleware: [requireSessionMiddleware] as const,
  security: [{ bearerAuth: [] }],
  request: { body: { content: { [MIME_TYPES.JSON]: { schema: UpsertCardSchema } } } },
  responses: {
    [CONTENTFUL_STATUS_CODES.CREATED]: {
      description: 'Card added successfully',
      content: { [MIME_TYPES.JSON]: { schema: CardWithPriceSchema } },
    },
    [CONTENTFUL_STATUS_CODES.BAD_REQUEST]: {
      description: 'Invalid card details',
      content: { [MIME_TYPES.JSON]: { schema: ValidationErrorResponseSchema } },
    },
    [CONTENTFUL_STATUS_CODES.UNAUTHORIZED]: {
      description: 'Authenticated session not found',
      content: { [MIME_TYPES.JSON]: { schema: ErrorResponseSchema } },
    },
    [CONTENTFUL_STATUS_CODES.SERVICE_UNAVAILABLE]: {
      description: 'Pricing is temporarily unavailable: the lock could not be acquired or the upstream failed',
      content: { [MIME_TYPES.JSON]: { schema: ErrorResponseSchema } },
    },
  },
});

export const CREATE_CARD_ROUTE_PATH = `${APP_API_ROUTE_NAME}${CARDS_ROUTE_NAME}` as const;

const createCardRoute = defineOpenAPIRoute<HonoEnvironment, typeof routeConfig>({
  route: routeConfig,
  handler: async c => {
    const createdCard = await c.get('cardRepository').create(c.req.valid('json'));
    const [price] = await c.get('cardPricingService').priceOwnedCards([createdCard]);

    const response = serializeCardWithPrice(createdCard, price);
    cardsLogger(c).info(
      { event: 'cards.create', outcome: 'success', card_id: response.id },
      'Added an owned card to the collection.',
    );

    return c.json(response, { status: CONTENTFUL_STATUS_CODES.CREATED });
  },
});

export default createCardRoute;
