import type { z } from '@hono/zod-openapi';
import { arrays } from '@kamaalio/kamaal';
import type { TypedResponse } from 'hono';

import { APP_API_ROUTE_NAME } from '../../constants/common.ts';
import { STATUS_CODES } from '../../constants/http.ts';
import type { HonoContext } from '../../context.ts';
import { withRequestLogger } from '../../logging/http.ts';
import { logInfo } from '../../logging/index.ts';
import { isNonEmpty } from '../../utils/type-utils.ts';
import { CARDS_ROUTE_NAME } from '../constants.ts';
import type { CardsListQuerySchema } from '../schemas/params.ts';
import { type CardsListResponse, CardsListResponseSchema } from '../schemas/responses.ts';
import { serializeCardWithPrice } from '../utils/cards.ts';

type ListCardsContext = HonoContext<
  typeof LIST_CARDS_ROUTE_PATH,
  { out: { query: z.infer<typeof CardsListQuerySchema> } }
>;

export const LIST_CARDS_ROUTE_PATH = `${APP_API_ROUTE_NAME}${CARDS_ROUTE_NAME}` as const;

async function listCardsHandler(
  c: ListCardsContext,
): Promise<TypedResponse<CardsListResponse, typeof STATUS_CODES.OK>> {
  const { game } = c.req.valid('query');
  const cards = await c.get('cardRepository').list(game);
  const prices = isNonEmpty(cards)
    ? await c.get('cardPricingService').priceOwnedCards(cards, { allowUnavailable: true })
    : [];
  const response = CardsListResponseSchema.parse({
    cards: arrays.zip(cards, [...prices], true).flatMap(([card, price]) => [serializeCardWithPrice(card, price)]),
  });
  logInfo(
    withRequestLogger(c, { component: 'cards' }),
    { event: 'cards.list', route: LIST_CARDS_ROUTE_PATH, outcome: 'success', card_count: response.cards.length, game },
    'Retrieved the owned card collection.',
  );

  return c.json(response, { status: STATUS_CODES.OK });
}

export default listCardsHandler;
