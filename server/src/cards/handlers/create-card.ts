import type { TypedResponse } from 'hono';

import { APP_API_ROUTE_NAME } from '../../constants/common.ts';
import { STATUS_CODES } from '../../constants/http.ts';
import type { HonoContext } from '../../context.ts';
import { withRequestLogger } from '../../logging/http.ts';
import { logInfo } from '../../logging/index.ts';
import { CARDS_ROUTE_NAME } from '../constants.ts';
import { createCardForSessionUser } from '../repository.ts';
import type { UpsertCard } from '../schemas/payloads.ts';
import { CardSchema, type Card } from '../schemas/responses.ts';
import { serializeCard } from '../utils/cards.ts';

type CreateCardContext = HonoContext<typeof CREATE_CARD_ROUTE_PATH, { out: { json: UpsertCard } }>;

// The router registers `path: '/'` under the mount without a trailing slash.
export const CREATE_CARD_ROUTE_PATH = `${APP_API_ROUTE_NAME}${CARDS_ROUTE_NAME}` as const;

const CREATE_CARD_STATUS = STATUS_CODES.CREATED;

async function createCardHandler(c: CreateCardContext): Promise<TypedResponse<Card, typeof CREATE_CARD_STATUS>> {
  const payload = c.req.valid('json');
  const createdCard = await createCardForSessionUser(c, payload);

  logInfo(
    withRequestLogger(c, { component: 'cards' }),
    {
      event: 'cards.create',
      route: CREATE_CARD_ROUTE_PATH,
      outcome: 'success',
    },
    'Created card entry successfully.',
  );

  return c.json(CardSchema.parse(serializeCard(createdCard)), { status: CREATE_CARD_STATUS });
}

export default createCardHandler;
