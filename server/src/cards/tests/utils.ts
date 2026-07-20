import type { Hono } from 'hono';

import type { HonoEnvironment } from '../../context.ts';
import { MIME_TYPES } from '../../constants/request.ts';
import { CREATE_CARD_ROUTE_PATH } from '../handlers/create-card.ts';
import type { UpsertCard } from '../schemas/payloads.ts';

export const validCardPayload: UpsertCard = {
  game: 'one_piece',
  name: 'Monkey D. Luffy',
  set_name: 'Romance Dawn',
  card_number: 'OP01-003',
  quantities: [
    { condition: 'near_mint', quantity: 2 },
    { condition: 'played', quantity: 1 },
  ],
};

export function sessionHeaders(sessionToken: string) {
  return new Headers({
    'Content-Type': MIME_TYPES.JSON,
    Cookie: `better-auth.session_token=${sessionToken}`,
  });
}

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
