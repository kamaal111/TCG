import { createRoute, defineOpenAPIRoute } from '@kamaalio/hono-standard-openapi';

import { requireSessionMiddleware } from '../../auth/module.ts';
import { APP_API_ROUTE_NAME } from '../../constants/common.ts';
import { CONTENTFUL_STATUS_CODES } from '../../constants/http.ts';
import { MIME_TYPES } from '../../constants/request.ts';
import type { HonoEnvironment } from '../../context.ts';
import { ErrorResponseSchema, ValidationErrorResponseSchema } from '../../schemas/errors.ts';
import { CARDS_OPENAPI_TAG, CARDS_ROUTE_NAME } from '../constants.ts';
import { cardsLogger } from '../logging.ts';
import { CardsPaginationQuerySchema } from '../schemas/params.ts';
import { ExportCardsResponseSchema } from '../schemas/responses.ts';
import { serializeCard } from '../utils/cards.ts';

const EXPORT_CARDS_PATH = '/export';

const routeConfig = createRoute({
  method: 'get',
  path: EXPORT_CARDS_PATH,
  tags: [CARDS_OPENAPI_TAG],
  summary: 'Export a page of owned cards without market pricing',
  description:
    "Export one page of the authenticated user's collection without fetching prices or changing purchase costs. Follow next_cursor until null for the complete backup.",
  middleware: [requireSessionMiddleware],
  security: [{ bearerAuth: [] }],
  request: { query: CardsPaginationQuerySchema },
  responses: {
    [CONTENTFUL_STATUS_CODES.OK]: {
      description: 'Collection backup page',
      content: { [MIME_TYPES.JSON]: { schema: ExportCardsResponseSchema } },
    },
    [CONTENTFUL_STATUS_CODES.BAD_REQUEST]: {
      description: 'Invalid pagination parameters',
      content: { [MIME_TYPES.JSON]: { schema: ValidationErrorResponseSchema } },
    },
    [CONTENTFUL_STATUS_CODES.INTERNAL_SERVER_ERROR]: {
      description: 'Unexpected server failure',
      content: { [MIME_TYPES.JSON]: { schema: ErrorResponseSchema } },
    },
    [CONTENTFUL_STATUS_CODES.UNAUTHORIZED]: {
      description: 'Session not found',
      content: { [MIME_TYPES.JSON]: { schema: ErrorResponseSchema } },
    },
  },
});

export const EXPORT_CARDS_ROUTE_PATH = `${APP_API_ROUTE_NAME}${CARDS_ROUTE_NAME}${routeConfig.path}` as const;

const exportCardsRoute = defineOpenAPIRoute<HonoEnvironment, typeof routeConfig>({
  route: routeConfig,
  handler: async c => {
    const { cards, nextCursor } = await c.get('cardRepository').listCollection({
      ...c.req.valid('query'),
      setNames: [],
    });

    const response = {
      cards: cards.map(card => ({ ...serializeCard(card), id: card.importSourceId ?? card.id })),
      next_cursor: nextCursor,
    };

    cardsLogger(c).info(
      { event: 'cards.export', outcome: 'success', result_count: cards.length },
      'Exported the owned card collection.',
    );

    return c.json(response, { status: CONTENTFUL_STATUS_CODES.OK });
  },
});

export default exportCardsRoute;
