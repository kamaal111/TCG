import { createRoute, defineOpenAPIRoute } from '@kamaalio/hono-standard-openapi';

import { requireSessionMiddleware } from '../../auth/module.ts';
import { APP_API_ROUTE_NAME } from '../../constants/common.ts';
import { CONTENTFUL_STATUS_CODES } from '../../constants/http.ts';
import { MIME_TYPES } from '../../constants/request.ts';
import type { HonoEnvironment } from '../../context.ts';
import {
  CardNotFoundErrorResponseSchema,
  ErrorResponseSchema,
  ValidationErrorResponseSchema,
} from '../../schemas/errors.ts';
import { CARDS_OPENAPI_TAG, CARDS_ROUTE_NAME } from '../constants.ts';
import { CardNotFound } from '../exceptions.ts';
import { cardsLogger } from '../logging.ts';
import { CardIdParamsSchema } from '../schemas/params.ts';
import { UpsertCardSchema } from '../schemas/payloads.ts';
import { CardWithPriceSchema } from '../schemas/responses.ts';
import { serializeCardWithPrice } from '../utils/cards.ts';

const UPDATE_CARD_PATH = '/{cardId}';

const routeConfig = createRoute({
  method: 'put',
  path: UPDATE_CARD_PATH,
  tags: [CARDS_OPENAPI_TAG],
  summary: 'Replace an owned card',
  description: 'Replace an owned card entry and all quantities for the authenticated user.',
  middleware: [requireSessionMiddleware] as const,
  security: [{ bearerAuth: [] }],
  request: {
    params: CardIdParamsSchema,
    body: { content: { [MIME_TYPES.JSON]: { schema: UpsertCardSchema } } },
  },
  responses: {
    [CONTENTFUL_STATUS_CODES.OK]: {
      description: 'Card updated successfully',
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
    [CONTENTFUL_STATUS_CODES.NOT_FOUND]: {
      description: 'Card not found or not owned by the authenticated user',
      content: { [MIME_TYPES.JSON]: { schema: CardNotFoundErrorResponseSchema } },
    },
    [CONTENTFUL_STATUS_CODES.SERVICE_UNAVAILABLE]: {
      description: 'Pricing is temporarily unavailable: the lock could not be acquired or the upstream failed',
      content: { [MIME_TYPES.JSON]: { schema: ErrorResponseSchema } },
    },
  },
});

export const UPDATE_CARD_ROUTE_PATH = `${APP_API_ROUTE_NAME}${CARDS_ROUTE_NAME}${routeConfig.path}` as const;

const updateCardRoute = defineOpenAPIRoute<HonoEnvironment, typeof routeConfig>({
  route: routeConfig,
  handler: async c => {
    const { cardId } = c.req.valid('param');
    const updatedCard = await c.get('cardRepository').update(cardId, c.req.valid('json'));

    if (updatedCard == null) {
      cardsLogger(c).warn(
        { event: 'cards.access_denied', outcome: 'failure', error_code: 'CARD_NOT_FOUND', card_id: cardId },
        'Card not found or not owned by the authenticated user.',
      );
      throw new CardNotFound(c);
    }

    const [price] = await c.get('cardPricingService').priceOwnedCards([updatedCard]);

    await c.get('cardRepository').backfillPurchasePrices([updatedCard], [price]);

    const response = serializeCardWithPrice(updatedCard, price);
    cardsLogger(c).info(
      { event: 'cards.update', outcome: 'success', card_id: cardId },
      'Updated an owned card in the collection.',
    );

    return c.json(response, { status: CONTENTFUL_STATUS_CODES.OK });
  },
});

export default updateCardRoute;
