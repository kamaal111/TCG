import { createRoute, defineOpenAPIRoute } from '@kamaalio/hono-standard-openapi';
import { ErrorResponseSchema, ValidationErrorResponseSchema } from '@tcg/http/error-schemas';
import { MIME_TYPES } from '@tcg/http/mime';
import { CONTENTFUL_STATUS_CODES } from '@tcg/http/status';

import { requireSessionMiddleware } from '../../auth/module.ts';
import { APP_API_ROUTE_NAME } from '../../constants/common.ts';
import type { HonoEnvironment } from '../../context.ts';
import { CARDS_OPENAPI_TAG, CARDS_ROUTE_NAME } from '../constants.ts';
import { InvalidCatalogPrinting } from '../exceptions.ts';
import type { ResolvedCSVCard } from '../repository.ts';
import { ImportCardsSchema } from '../schemas/payloads.ts';
import { ImportCardsResponseSchema } from '../schemas/responses.ts';

const IMPORT_CARDS_PATH = '/import';

const routeConfig = createRoute({
  method: 'post',
  path: IMPORT_CARDS_PATH,
  tags: [CARDS_OPENAPI_TAG],
  summary: 'Import catalog cards and update their ownership details',
  description:
    "Import catalog cards into the authenticated user's collection. Matching owned IDs and printings replace ownership details; unchanged cards are skipped.",
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
    const { cards } = c.req.valid('json');
    const printings = await c.get('cardPricingService').catalogPrintings(cards.map(card => card.priced_card_id));
    const resolved: ResolvedCSVCard[] = [];
    const missing: (string | number)[][] = [];

    for (const [sourceIndex, { priced_card_id, ...values }] of cards.entries()) {
      const printing = printings.get(priced_card_id.toLowerCase());

      if (printing == null) {
        missing.push(['cards', sourceIndex, 'priced_card_id']);
      } else {
        resolved.push({ ...values, printing, sourceIndex });
      }
    }

    if (missing.length > 0) {
      throw new InvalidCatalogPrinting(missing, 'import');
    }

    const response = await c.get('cardRepository').importCards(resolved);

    return c.json(response, { status: CONTENTFUL_STATUS_CODES.OK });
  },
});

export default importCardsRoute;
