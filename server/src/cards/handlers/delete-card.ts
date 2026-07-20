import type { TypedResponse } from 'hono';

import { APP_API_ROUTE_NAME } from '../../constants/common.ts';
import { STATUS_CODES } from '../../constants/http.ts';
import type { HonoContext } from '../../context.ts';
import { withRequestLogger } from '../../logging/http.ts';
import { logInfo } from '../../logging/index.ts';
import { CARDS_ROUTE_NAME } from '../constants.ts';
import { CardNotFound } from '../exceptions.ts';
import { CardRepository } from '../repository.ts';
import deleteCardRoute from '../routes/delete-card.ts';
import type { DeleteCardResponse } from '../schemas/responses.ts';

type DeleteCardContext = HonoContext<typeof DELETE_CARD_ROUTE_PATH, { out: { param: { cardId: string } } }>;

export const DELETE_CARD_ROUTE_PATH = `${APP_API_ROUTE_NAME}${CARDS_ROUTE_NAME}${deleteCardRoute.path}` as const;

async function deleteCardHandler(
  c: DeleteCardContext,
): Promise<TypedResponse<DeleteCardResponse, typeof STATUS_CODES.OK>> {
  const { cardId } = c.req.valid('param');
  const deleted = await CardRepository.delete(c, cardId);
  if (!deleted) throw new CardNotFound(c);

  logInfo(
    withRequestLogger(c, { component: 'cards' }),
    { event: 'cards.delete', route: DELETE_CARD_ROUTE_PATH, outcome: 'success', card_id: cardId },
    'Deleted an owned card from the collection.',
  );

  return c.json({}, { status: STATUS_CODES.OK });
}

export default deleteCardHandler;
