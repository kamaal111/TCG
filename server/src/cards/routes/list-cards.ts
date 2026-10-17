import { createRoute, defineOpenAPIRoute } from '@kamaalio/hono-standard-openapi';
import { zip } from '@kamaalio/kamaal/arrays';

import { requireSessionMiddleware } from '../../auth/module.ts';
import { APP_API_ROUTE_NAME } from '../../constants/common.ts';
import { CONTENTFUL_STATUS_CODES } from '../../constants/http.ts';
import { MIME_TYPES } from '../../constants/request.ts';
import type { HonoEnvironment } from '../../context.ts';
import { logDisplayPrices } from '../../forex/logging.ts';
import { ErrorResponseSchema, ValidationErrorResponseSchema } from '../../schemas/errors.ts';
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
  description:
    "List one page of the authenticated user's owned cards, newest first, with complete game-scoped set choices. Follow next_cursor until null for all matching cards.",
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
    [CONTENTFUL_STATUS_CODES.BAD_REQUEST]: {
      description: 'Invalid collection filters or pagination parameters',
      content: { [MIME_TYPES.JSON]: { schema: ValidationErrorResponseSchema } },
    },
    [CONTENTFUL_STATUS_CODES.INTERNAL_SERVER_ERROR]: {
      description: 'Unexpected server failure',
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
    const { game, set_name, ...pagination } = c.req.valid('query');

    const repository = c.get('cardRepository');

    const [{ cards, availableSetNames, nextCursor }, display] = await Promise.all([
      repository.listCollection({
        ...pagination,
        game,
        setNames: set_name ?? [],
      }),
      c.get('forexService').displayContext(),
    ]);

    if (display.isErr()) {
      throw display.error;
    }

    const prices = isNonEmpty(cards)
      ? await c.get('cardPricingService').priceOwnedCards(cards, { allowUnavailable: true })
      : [];

    await repository.backfillPurchasePrices(cards, prices);

    const cardsWithPrices = zip([...cards], [...prices], true);

    const response = {
      cards: cardsWithPrices.flatMap(([card, price]) => [serializeCardWithPrice(card, price, display.value)]),
      available_set_names: availableSetNames,
      next_cursor: nextCursor,
    };

    logDisplayPrices(c, display.value, response.cards);
    cardsLogger(c).info(
      { event: 'cards.list', outcome: 'success', result_count: response.cards.length, game },
      'Retrieved the owned card collection.',
    );

    return c.json(response, { status: CONTENTFUL_STATUS_CODES.OK });
  },
});

export default listCardsRoute;
