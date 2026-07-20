import type { TypedResponse } from 'hono';

import { APP_API_ROUTE_NAME } from '../../constants/common.ts';
import { STATUS_CODES } from '../../constants/http.ts';
import type { HonoContext } from '../../context.ts';
import { withRequestLogger } from '../../logging/http.ts';
import { logInfo } from '../../logging/index.ts';
import { CARDS_ROUTE_NAME } from '../constants.ts';
import { CardRepository } from '../repository.ts';
import type { UpsertCard } from '../schemas/payloads.ts';
import type { CardResponse } from '../schemas/responses.ts';
import { serializeCard } from '../utils/cards.ts';

type CreateCardContext = HonoContext<typeof CREATE_CARD_ROUTE_PATH, { out: { json: UpsertCard } }>;

export const CREATE_CARD_ROUTE_PATH = `${APP_API_ROUTE_NAME}${CARDS_ROUTE_NAME}` as const;

async function createCardHandler(
  c: CreateCardContext,
): Promise<TypedResponse<CardResponse, typeof STATUS_CODES.CREATED>> {
  const createdCard = await CardRepository.create(c, c.req.valid('json'));
  const response = serializeCard(createdCard);
  logInfo(
    withRequestLogger(c, { component: 'cards' }),
    { event: 'cards.create', route: CREATE_CARD_ROUTE_PATH, outcome: 'success', card_id: response.id },
    'Added an owned card to the collection.',
  );

  return c.json(response, { status: STATUS_CODES.CREATED });
}

export default createCardHandler;
