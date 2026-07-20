import type { TypedResponse } from 'hono';

import { APP_API_ROUTE_NAME } from '../../constants/common.ts';
import { STATUS_CODES } from '../../constants/http.ts';
import type { HonoContext } from '../../context.ts';
import { withRequestLogger } from '../../logging/http.ts';
import { logInfo } from '../../logging/index.ts';
import { CARDS_ROUTE_NAME } from '../constants.ts';
import { CardRepository } from '../repository.ts';
import { CardsListResponseSchema, type CardsListResponse } from '../schemas/responses.ts';
import { serializeCard } from '../utils/cards.ts';

type ListCardsContext = HonoContext<typeof LIST_CARDS_ROUTE_PATH>;

export const LIST_CARDS_ROUTE_PATH = `${APP_API_ROUTE_NAME}${CARDS_ROUTE_NAME}` as const;

async function listCardsHandler(
  c: ListCardsContext,
): Promise<TypedResponse<CardsListResponse, typeof STATUS_CODES.OK>> {
  const cards = await CardRepository.list(c);
  const response = CardsListResponseSchema.parse({ cards: cards.map(serializeCard) });
  logInfo(
    withRequestLogger(c, { component: 'cards' }),
    { event: 'cards.list', route: LIST_CARDS_ROUTE_PATH, outcome: 'success', card_count: response.cards.length },
    'Retrieved the owned card collection.',
  );

  return c.json(response, { status: STATUS_CODES.OK });
}

export default listCardsHandler;
