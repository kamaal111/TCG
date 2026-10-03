import { createRoute, defineOpenAPIRoute } from '@kamaalio/hono-standard-openapi';
import { zip } from '@kamaalio/kamaal/arrays';

import { requireSessionMiddleware } from '../../auth/module.ts';
import { APP_API_ROUTE_NAME } from '../../constants/common.ts';
import { CONTENTFUL_STATUS_CODES } from '../../constants/http.ts';
import { MIME_TYPES } from '../../constants/request.ts';
import type { HonoEnvironment } from '../../context.ts';
import { ErrorResponseSchema } from '../../schemas/errors.ts';
import { isNonEmpty } from '../../utils/type-utils.ts';
import { CARDS_OPENAPI_TAG, CARDS_ROUTE_NAME } from '../constants.ts';
import { cardsLogger } from '../logging.ts';
import { CardsListQuerySchema } from '../schemas/params.ts';
import { CardsListResponseSchema } from '../schemas/responses.ts';
import { serializeCardWithPrice } from '../utils/cards.ts';

const LIST_CARDS_PATH = '/';

const routeConfig = createRoute({
  method: 'get',
  path: LIST_CARDS_PATH,
  tags: [CARDS_OPENAPI_TAG],
  summary: 'List owned cards',
  description: "List the authenticated user's owned card entries, newest first.",
  middleware: [requireSessionMiddleware] as const,
  security: [{ bearerAuth: [] }],
  request: { query: CardsListQuerySchema },
  responses: {
    [CONTENTFUL_STATUS_CODES.OK]: {
      description: 'Collection retrieved successfully',
      content: { [MIME_TYPES.JSON]: { schema: CardsListResponseSchema } },
    },
    [CONTENTFUL_STATUS_CODES.UNAUTHORIZED]: {
      description: 'Authenticated session not found',
      content: { [MIME_TYPES.JSON]: { schema: ErrorResponseSchema } },
    },
    [CONTENTFUL_STATUS_CODES.SERVICE_UNAVAILABLE]: {
      description: 'Pricing is temporarily unavailable because the upstream provider failed',
      content: { [MIME_TYPES.JSON]: { schema: ErrorResponseSchema } },
    },
  },
});

export const LIST_CARDS_ROUTE_PATH = `${APP_API_ROUTE_NAME}${CARDS_ROUTE_NAME}` as const;

const listCardsRoute = defineOpenAPIRoute<HonoEnvironment, typeof routeConfig>({
  route: routeConfig,
  handler: async c => {
    const { game } = c.req.valid('query');
    const cards = await c.get('cardRepository').list(game);

    const prices = isNonEmpty(cards)
      ? await c.get('cardPricingService').priceOwnedCards(cards, { allowUnavailable: true })
      : [];

    const cardsWithPrices = zip([...cards], [...prices], true);

    const response = CardsListResponseSchema.parse({
      cards: cardsWithPrices.flatMap(([card, price]) => [serializeCardWithPrice(card, price)]),
    });

    cardsLogger(c).info(
      { event: 'cards.list', outcome: 'success', result_count: response.cards.length, game },
      'Retrieved the owned card collection.',
    );

    return c.json(response, { status: CONTENTFUL_STATUS_CODES.OK });
  },
});

export default listCardsRoute;
