import type { TypedResponse } from 'hono';

import { APP_API_ROUTE_NAME } from '../../constants/common.ts';
import { STATUS_CODES } from '../../constants/http.ts';
import type { HonoContext } from '../../context.ts';
import { withRequestLogger } from '../../logging/http.ts';
import { logInfo } from '../../logging/index.ts';
import { CARDS_ROUTE_NAME } from '../constants.ts';
import { listCardsForSessionUser } from '../repository.ts';
import { CardsListResponseSchema, type CardsListResponse } from '../schemas/responses.ts';
import { serializeCard } from '../utils/cards.ts';

type ListCardsContext = HonoContext<typeof LIST_CARDS_ROUTE_PATH>;

// The router registers `path: '/'` under the mount without a trailing slash.
export const LIST_CARDS_ROUTE_PATH = `${APP_API_ROUTE_NAME}${CARDS_ROUTE_NAME}` as const;

const LIST_CARDS_STATUS = STATUS_CODES.OK;

async function listCardsHandler(
  c: ListCardsContext,
): Promise<TypedResponse<CardsListResponse, typeof LIST_CARDS_STATUS>> {
  const cards = await listCardsForSessionUser(c);

  logInfo(
    withRequestLogger(c, { component: 'cards' }),
    {
      event: 'cards.list',
      route: LIST_CARDS_ROUTE_PATH,
      outcome: 'success',
      result_count: cards.length,
    },
    'Listed card entries successfully.',
  );

  return c.json(CardsListResponseSchema.parse({ cards: cards.map(serializeCard) }), { status: LIST_CARDS_STATUS });
}

export default listCardsHandler;
