import { APP_API_ROUTE_NAME } from '../../constants/common.ts';
import { STATUS_CODES } from '../../constants/http.ts';
import type { HonoContext } from '../../context.ts';
import { CARDS_ROUTE_NAME } from '../constants.ts';
import { CardNotFound } from '../exceptions.ts';
import { cardsLogger } from '../logging.ts';
import deleteCardRoute, { type DeleteCardRouteResponse } from '../routes/delete-card.ts';

type DeleteCardContext = HonoContext<typeof DELETE_CARD_ROUTE_PATH, { out: { param: { cardId: string } } }>;

export const DELETE_CARD_ROUTE_PATH = `${APP_API_ROUTE_NAME}${CARDS_ROUTE_NAME}${deleteCardRoute.path}` as const;

async function deleteCardHandler(c: DeleteCardContext): Promise<DeleteCardRouteResponse> {
  const { cardId } = c.req.valid('param');
  const deleted = await c.get('cardRepository').delete(cardId);
  if (!deleted) {
    cardsLogger(c).warn(
      { event: 'cards.access_denied', outcome: 'failure', error_code: 'CARD_NOT_FOUND', card_id: cardId },
      'Card not found or not owned by the authenticated user.',
    );
    throw new CardNotFound(c);
  }

  cardsLogger(c).info(
    { event: 'cards.delete', outcome: 'success', card_id: cardId },
    'Deleted an owned card from the collection.',
  );

  return c.json({}, { status: STATUS_CODES.OK });
}

export default deleteCardHandler;
