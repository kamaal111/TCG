import { APP_API_ROUTE_NAME } from '../../constants/common.ts';
import { STATUS_CODES } from '../../constants/http.ts';
import type { HonoContext } from '../../context.ts';
import { CARDS_ROUTE_NAME } from '../constants.ts';
import { cardsLogger } from '../logging.ts';
import type { CreateCardRouteResponse } from '../routes/create-card.ts';
import type { UpsertCard } from '../schemas/payloads.ts';
import { serializeCardWithPrice } from '../utils/cards.ts';

type CreateCardContext = HonoContext<typeof CREATE_CARD_ROUTE_PATH, { out: { json: UpsertCard } }>;

export const CREATE_CARD_ROUTE_PATH = `${APP_API_ROUTE_NAME}${CARDS_ROUTE_NAME}` as const;

async function createCardHandler(c: CreateCardContext): Promise<CreateCardRouteResponse> {
  const createdCard = await c.get('cardRepository').create(c.req.valid('json'));
  const [price] = await c.get('cardPricingService').priceOwnedCards([createdCard]);

  const response = serializeCardWithPrice(createdCard, price);
  cardsLogger(c).info(
    { event: 'cards.create', outcome: 'success', card_id: response.id },
    'Added an owned card to the collection.',
  );

  return c.json(response, { status: STATUS_CODES.CREATED });
}

export default createCardHandler;
