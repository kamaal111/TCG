import { createRoute, defineOpenAPIRoute } from '@kamaalio/hono-standard-openapi';
import { zip } from '@kamaalio/kamaal/arrays';

import { serializeCardWithPrice } from '../../cards/utils/cards.ts';
import { CONTENTFUL_STATUS_CODES } from '../../constants/http.ts';
import { MIME_TYPES } from '../../constants/request.ts';
import type { HonoEnvironment } from '../../context.ts';
import { isNonEmpty } from '../../utils/type-utils.ts';
import type { CollectionRouteDependencies } from '../route-dependencies.ts';
import { PageParamsSchema } from '../schemas/params.ts';
import { BinderPageCardsSchema } from '../schemas/responses.ts';

export function createGetPageRoute({ common, errors }: CollectionRouteDependencies) {
  const routeConfig = createRoute({
    ...common,
    method: 'get',
    path: '/{collectionId}/pages/{pageId}',
    summary: 'Get binder page cards',
    request: { params: PageParamsSchema },
    responses: {
      ...errors,
      [CONTENTFUL_STATUS_CODES.OK]: {
        description: 'Page with card details',
        content: {
          [MIME_TYPES.JSON]: {
            schema: BinderPageCardsSchema,
          },
        },
      },
    },
  });

  return defineOpenAPIRoute<HonoEnvironment, typeof routeConfig>({
    route: routeConfig,
    handler: async c => {
      const { collectionId, pageId } = c.req.valid('param');
      const result = await c.get('collectionRepository').page(collectionId, pageId);
      const display = await c.get('forexService').displayContext();

      if (display.isErr()) {
        throw display.error;
      }

      const prices = isNonEmpty(result.cards)
        ? await c.get('cardPricingService').priceOwnedCards(result.cards, { allowUnavailable: true })
        : [];

      const cards = zip([...result.cards], [...prices], true).map(([card, price]) =>
        serializeCardWithPrice(card, price, display.value),
      );

      return c.json({ cards }, { status: CONTENTFUL_STATUS_CODES.OK });
    },
  });
}
