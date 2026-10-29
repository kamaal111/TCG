import type { Hono } from 'hono';

import type { HonoEnvironment } from '../../context.ts';
import { sessionHeaders } from '../../tests/auth.ts';
import { CREATE_CARD_ROUTE_PATH } from '../routes/create-card.ts';
import type { UpsertCard } from '../schemas/payloads.ts';
import { CardWithPriceSchema } from '../schemas/responses.ts';

export const validCardPayload: UpsertCard = {
  game: 'one_piece',
  name: 'Monkey D. Luffy',
  set_name: 'Romance Dawn',
  card_number: 'OP01-003',
  purchases: [
    { condition: 'near_mint', quantity: 2, purchase_price: null, currency: null },
    { condition: 'played', quantity: 1, purchase_price: null, currency: null },
  ],
};

export function createCardRequest(
  app: Hono<HonoEnvironment>,
  sessionToken: string,
  payload: UpsertCard = validCardPayload,
) {
  return app.request(CREATE_CARD_ROUTE_PATH, {
    method: 'POST',
    headers: sessionHeaders(sessionToken),
    body: JSON.stringify(payload),
  });
}

export async function createTestCard(
  app: Hono<HonoEnvironment>,
  sessionToken: string,
  payload: UpsertCard = validCardPayload,
) {
  const response = await createCardRequest(app, sessionToken, payload);
  expect(response.status).toBe(201);

  return CardWithPriceSchema.parse(await response.json());
}
