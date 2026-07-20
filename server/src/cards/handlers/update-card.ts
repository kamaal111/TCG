import type { TypedResponse } from 'hono';

import { APP_API_ROUTE_NAME } from '../../constants/common.ts';
import { STATUS_CODES } from '../../constants/http.ts';
import type { HonoContext } from '../../context.ts';
import { withRequestLogger } from '../../logging/http.ts';
import { logInfo } from '../../logging/index.ts';
import { CARDS_ROUTE_NAME } from '../constants.ts';
import { CardNotFound } from '../exceptions.ts';
import { updateCardReplacingQuantitiesForSessionUser } from '../repository.ts';
import updateCardRoute from '../routes/update-card.ts';
import type { UpsertCard } from '../schemas/payloads.ts';
import { CardSchema, type Card } from '../schemas/responses.ts';
import { serializeCard } from '../utils/cards.ts';

type UpdateCardContext = HonoContext<
  typeof UPDATE_CARD_ROUTE_PATH,
  { out: { json: UpsertCard; param: { cardId: string } } }
>;

export const UPDATE_CARD_ROUTE_PATH = `${APP_API_ROUTE_NAME}${CARDS_ROUTE_NAME}${updateCardRoute.path}` as const;

const UPDATE_CARD_STATUS = STATUS_CODES.OK;

async function updateCardHandler(c: UpdateCardContext): Promise<TypedResponse<Card, typeof UPDATE_CARD_STATUS>> {
  const { cardId } = c.req.valid('param');
  const payload = c.req.valid('json');
  const updatedCard = await updateCardReplacingQuantitiesForSessionUser(c, cardId, payload);
  if (updatedCard == null) {
    throw new CardNotFound(c);
  }

  logInfo(
    withRequestLogger(c, { component: 'cards' }),
    {
      event: 'cards.update',
      route: UPDATE_CARD_ROUTE_PATH,
      outcome: 'success',
    },
    'Updated card entry successfully.',
  );

  return c.json(CardSchema.parse(serializeCard(updatedCard)), { status: UPDATE_CARD_STATUS });
}

export default updateCardHandler;
