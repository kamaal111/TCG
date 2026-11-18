import { createRoute, defineOpenAPIRoute } from '@kamaalio/hono-standard-openapi';
import { ErrorResponseSchema, ValidationErrorResponseSchema } from '@tcg/http/error-schemas';
import { MIME_TYPES } from '@tcg/http/mime';
import { CONTENTFUL_STATUS_CODES } from '@tcg/http/status';

import { requireSessionMiddleware } from '../../auth/module.ts';
import { APP_API_ROUTE_NAME } from '../../constants/common.ts';
import type { HonoEnvironment } from '../../context.ts';
import { CARDS_OPENAPI_TAG, CARDS_ROUTE_NAME } from '../constants.ts';
import { cardsLogger } from '../logging.ts';
import { CardsListQuerySchema } from '../schemas/params.ts';
import { CardsListResponseSchema } from '../schemas/responses.ts';
import { serializeOwnedCardDetails } from '../utils/cards.ts';

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
    [CONTENTFUL_STATUS_CODES.NOT_FOUND]: {
      description: 'Collection not found',
      content: { [MIME_TYPES.JSON]: { schema: ErrorResponseSchema } },
    },
  },
});

export const LIST_CARDS_ROUTE_PATH = `${APP_API_ROUTE_NAME}${CARDS_ROUTE_NAME}` as const;

const listCardsRoute = defineOpenAPIRoute<HonoEnvironment, typeof routeConfig>({
  route: routeConfig,
  handler: async c => {
    const { game, set_name, illustrator, ...pagination } = c.req.valid('query');

    const repository = c.get('cardRepository');

    const { cards, availableSetNames, availableIllustrators, nextCursor } = await repository.listCollection({
      ...pagination,
      game,
      setNames: set_name ?? [],
      illustrators: illustrator ?? [],
      backfillEnglishAliases: true,
    });

    const response = {
      cards: await serializeOwnedCardDetails(c, cards),
      available_set_names: availableSetNames,
      available_illustrators: availableIllustrators,
      next_cursor: nextCursor,
    };

    cardsLogger(c).info(
      { event: 'cards.list', outcome: 'success', result_count: response.cards.length, game },
      'Retrieved the owned card collection.',
    );

    return c.json(response, { status: CONTENTFUL_STATUS_CODES.OK });
  },
});

export default listCardsRoute;
