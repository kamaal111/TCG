import { createRoute, defineOpenAPIRoute } from '@kamaalio/hono-standard-openapi';
import { zip } from '@kamaalio/kamaal/arrays';
import { MIME_TYPES } from '@tcg/http/mime';
import { CONTENTFUL_STATUS_CODES } from '@tcg/http/status';
import { z } from 'zod';

import type { HonoEnvironment } from '../../context.ts';
import { logDisplayPrices } from '../../forex/logging.ts';
import { UuidSchema } from '../../schemas/common.ts';
import { isNonEmpty } from '../../utils/type-utils.ts';
import { authenticated, invalid, unauthorized } from '../offline-route-dependencies.ts';
import { OwnedCardPricesSchema } from '../schemas/responses.ts';
import { serializeOwnedPriceUpdate } from '../utils/cards.ts';

const request = z
  .object({
    card_ids: z
      .array(UuidSchema)
      .nonempty()
      .max(100)
      .refine(ids => new Set(ids.map(id => id.toLowerCase())).size === ids.length, 'Card IDs must be distinct'),
  })
  .meta({ $id: 'OwnedCardPricesRequest' });

const route = createRoute({
  ...authenticated,
  method: 'post',
  path: '/prices',
  operationId: 'getOwnedCardPrices',
  summary: 'Refresh prices for owned cards',
  request: { body: { required: true, content: { [MIME_TYPES.JSON]: { schema: request } } } },
  responses: {
    [CONTENTFUL_STATUS_CODES.OK]: {
      description: 'Price results for accessible cards',
      content: { [MIME_TYPES.JSON]: { schema: OwnedCardPricesSchema } },
    },
    [CONTENTFUL_STATUS_CODES.BAD_REQUEST]: invalid,
    [CONTENTFUL_STATUS_CODES.UNAUTHORIZED]: unauthorized,
  },
});

export default defineOpenAPIRoute<HonoEnvironment, typeof route>({
  route,
  handler: async c => {
    const { card_ids } = c.req.valid('json');
    const repository = c.get('cardRepository');
    const cards = await repository.getMany(card_ids);

    if (!isNonEmpty(cards)) {
      return c.json({ prices: [] }, CONTENTFUL_STATUS_CODES.OK);
    }

    const display = await c.get('forexService').displayContext();

    if (display.isErr()) {
      throw display.error;
    }

    const prices = await c.get('cardPricingService').priceOwnedCards(cards, { allowUnavailable: true });
    await repository.backfillPurchasePrices(cards, prices);

    const updates = zip([...cards], [...prices], true).map(([card, price]) => {
      return serializeOwnedPriceUpdate(card, price, display.value);
    });

    logDisplayPrices(c, display.value, updates);

    return c.json({ prices: updates }, CONTENTFUL_STATUS_CODES.OK);
  },
});
