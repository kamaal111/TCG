import type { TypedResponse } from 'hono';

import { APP_API_ROUTE_NAME } from '../../constants/common.ts';
import { STATUS_CODES } from '../../constants/http.ts';
import type { HonoContext } from '../../context.ts';
import { withRequestLogger } from '../../logging/http.ts';
import { logInfo, logWarn } from '../../logging/index.ts';
import { CARDS_ROUTE_NAME } from '../constants.ts';
import { CardNotFound } from '../exceptions.ts';
import updateCardRoute from '../routes/update-card.ts';
import type { UpsertCard } from '../schemas/payloads.ts';
import type { CardWithPriceResponse } from '../schemas/responses.ts';
import { serializeCardWithPrice } from '../utils/cards.ts';

type UpdateCardContext = HonoContext<
  typeof UPDATE_CARD_ROUTE_PATH,
  { out: { json: UpsertCard; param: { cardId: string } } }
>;

export const UPDATE_CARD_ROUTE_PATH = `${APP_API_ROUTE_NAME}${CARDS_ROUTE_NAME}${updateCardRoute.path}` as const;

async function updateCardHandler(
  c: UpdateCardContext,
): Promise<TypedResponse<CardWithPriceResponse, typeof STATUS_CODES.OK>> {
  const { cardId } = c.req.valid('param');
  const updatedCard = await c.get('cardRepository').update(cardId, c.req.valid('json'));
  if (updatedCard == null) {
    logWarn(
      withRequestLogger(c, { component: 'cards' }),
      {
        event: 'cards.access_denied',
        route: UPDATE_CARD_ROUTE_PATH,
        outcome: 'failure',
        error_code: 'CARD_NOT_FOUND',
        card_id: cardId,
      },
      'Card not found or not owned by the authenticated user.',
    );
    throw new CardNotFound(c);
  }

  const [price] = await c.get('cardPricingService').priceOwnedCards([updatedCard]);

  const response = serializeCardWithPrice(updatedCard, price);
  logInfo(
    withRequestLogger(c, { component: 'cards' }),
    { event: 'cards.update', route: UPDATE_CARD_ROUTE_PATH, outcome: 'success', card_id: cardId },
    'Updated an owned card in the collection.',
  );

  return c.json(response, { status: STATUS_CODES.OK });
}

export default updateCardHandler;
