import type { TypedResponse } from 'hono';

import { APP_API_ROUTE_NAME } from '../../constants/common.ts';
import { STATUS_CODES } from '../../constants/http.ts';
import type { HonoContext } from '../../context.ts';
import { withRequestLogger } from '../../logging/http.ts';
import { logInfo } from '../../logging/index.ts';
import { CARDS_ROUTE_NAME } from '../constants.ts';
import { CardNotFound } from '../exceptions.ts';
import { deleteCardForSessionUser } from '../repository.ts';
import deleteCardRoute from '../routes/delete-card.ts';
import { DeleteCardResponseSchema, type DeleteCardResponse } from '../schemas/responses.ts';

type DeleteCardContext = HonoContext<typeof DELETE_CARD_ROUTE_PATH, { out: { param: { cardId: string } } }>;

export const DELETE_CARD_ROUTE_PATH = `${APP_API_ROUTE_NAME}${CARDS_ROUTE_NAME}${deleteCardRoute.path}` as const;

const DELETE_CARD_STATUS = STATUS_CODES.OK;

async function deleteCardHandler(
  c: DeleteCardContext,
): Promise<TypedResponse<DeleteCardResponse, typeof DELETE_CARD_STATUS>> {
  const { cardId } = c.req.valid('param');
  const deleted = await deleteCardForSessionUser(c, cardId);
  if (!deleted) {
    throw new CardNotFound(c);
  }

  logInfo(
    withRequestLogger(c, { component: 'cards' }),
    {
      event: 'cards.delete',
      route: DELETE_CARD_ROUTE_PATH,
      outcome: 'success',
    },
    'Deleted card entry successfully.',
  );

  return c.json(DeleteCardResponseSchema.parse({}), { status: DELETE_CARD_STATUS });
}

export default deleteCardHandler;
