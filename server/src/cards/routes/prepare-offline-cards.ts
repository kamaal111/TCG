import { createRoute, defineOpenAPIRoute } from '@kamaalio/hono-standard-openapi';
import { MIME_TYPES } from '@tcg/http/mime';
import { CONTENTFUL_STATUS_CODES } from '@tcg/http/status';

import { OWNED_CARD_PRICE_STATUSES } from '../../card-pricing/schemas/responses.ts';
import type { HonoEnvironment } from '../../context.ts';
import { isNonEmpty } from '../../utils/type-utils.ts';
import { authenticated, invalid, unauthorized } from '../offline-route-dependencies.ts';
import { PrepareOfflineCardsRequestSchema, PrepareOfflineCardsResponseSchema } from '../schemas/offline-collection.ts';

const routeConfig = createRoute({
  ...authenticated,
  method: 'post',
  path: '/offline/prepare',
  operationId: 'prepareOfflineCollectionCards',
  summary: 'Resolve missing offline card details',
  description:
    'Resolve provider details for owned cards with no cached result. Refresh the manifest after preparation to get updated record digests.',
  request: {
    body: {
      content: {
        [MIME_TYPES.JSON]: { schema: PrepareOfflineCardsRequestSchema },
      },
    },
  },
  responses: {
    [CONTENTFUL_STATUS_CODES.OK]: {
      description: 'Temporary provider failures to retry',
      content: { [MIME_TYPES.JSON]: { schema: PrepareOfflineCardsResponseSchema } },
    },
    [CONTENTFUL_STATUS_CODES.BAD_REQUEST]: invalid,
    [CONTENTFUL_STATUS_CODES.UNAUTHORIZED]: unauthorized,
  },
});

const prepareOfflineCardsRoute = defineOpenAPIRoute<HonoEnvironment, typeof routeConfig>({
  route: routeConfig,
  handler: async c => {
    const { card_ids } = c.req.valid('json');
    const { cards } = await c.get('offlineCollectionRepository').read({ cards: card_ids, collections: [] });
    const unresolved = cards.flatMap(card => (card.price == null ? [card.owned] : []));

    const prices = isNonEmpty(unresolved)
      ? await c.get('cardPricingService').priceOwnedCards(unresolved, { allowUnavailable: true })
      : [];

    const retry = prices.flatMap(price => {
      return price.status === OWNED_CARD_PRICE_STATUSES.UNAVAILABLE ? [price.card_id] : [];
    });

    return c.json({ retry_card_ids: retry }, CONTENTFUL_STATUS_CODES.OK);
  },
});

export default prepareOfflineCardsRoute;
