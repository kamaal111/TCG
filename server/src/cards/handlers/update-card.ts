import type { TypedResponse } from 'hono';

import { APP_API_ROUTE_NAME } from '../../constants/common.ts';
import { STATUS_CODES } from '../../constants/http.ts';
import type { HonoContext } from '../../context.ts';
import { withRequestLogger } from '../../logging/http.ts';
import { logInfo } from '../../logging/index.ts';
import { CARDS_ROUTE_NAME } from '../constants.ts';
import { CardNotFound } from '../exceptions.ts';
import { CardRepository } from '../repository.ts';
import updateCardRoute from '../routes/update-card.ts';
import type { UpsertCard } from '../schemas/payloads.ts';
import type { CardResponse } from '../schemas/responses.ts';
import { serializeCard } from '../utils/cards.ts';

type UpdateCardContext = HonoContext<
  typeof UPDATE_CARD_ROUTE_PATH,
  { out: { json: UpsertCard; param: { cardId: string } } }
>;

export const UPDATE_CARD_ROUTE_PATH = `${APP_API_ROUTE_NAME}${CARDS_ROUTE_NAME}${updateCardRoute.path}` as const;

async function updateCardHandler(c: UpdateCardContext): Promise<TypedResponse<CardResponse, typeof STATUS_CODES.OK>> {
  const { cardId } = c.req.valid('param');
  const updatedCard = await CardRepository.update(c, cardId, c.req.valid('json'));
  if (updatedCard == null) throw new CardNotFound(c);

  const response = serializeCard(updatedCard);
  logInfo(
    withRequestLogger(c, { component: 'cards' }),
    { event: 'cards.update', route: UPDATE_CARD_ROUTE_PATH, outcome: 'success', card_id: cardId },
    'Updated an owned card in the collection.',
  );

  return c.json(response, { status: STATUS_CODES.OK });
}

export default updateCardHandler;
