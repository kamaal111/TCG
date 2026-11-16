import { createRoute, defineOpenAPIRoute } from '@kamaalio/hono-standard-openapi';
import { ErrorResponseSchema } from '@tcg/http/error-schemas';
import { MIME_TYPES } from '@tcg/http/mime';
import { CONTENTFUL_STATUS_CODES } from '@tcg/http/status';

import type { HonoEnvironment } from '../../context.ts';
import { CardNotFound } from '../exceptions.ts';
import { authenticated, invalid, unauthorized } from '../offline-route-dependencies.ts';
import { CardIdParamsSchema } from '../schemas/params.ts';
import { OwnedCardDetailsSchema } from '../schemas/responses.ts';
import { serializeOwnedCardDetails } from '../utils/cards.ts';

const route = createRoute({
  ...authenticated,
  method: 'get',
  path: '/{cardId}',
  operationId: 'getOwnedCard',
  summary: 'Get an owned card',
  request: { params: CardIdParamsSchema },
  responses: {
    [CONTENTFUL_STATUS_CODES.OK]: {
      description: 'Owned card details',
      content: { [MIME_TYPES.JSON]: { schema: OwnedCardDetailsSchema } },
    },
    [CONTENTFUL_STATUS_CODES.BAD_REQUEST]: invalid,
    [CONTENTFUL_STATUS_CODES.UNAUTHORIZED]: unauthorized,
    [CONTENTFUL_STATUS_CODES.NOT_FOUND]: {
      description: 'Owned card not found',
      content: { [MIME_TYPES.JSON]: { schema: ErrorResponseSchema } },
    },
  },
});

export default defineOpenAPIRoute<HonoEnvironment, typeof route>({
  route,
  handler: async c => {
    const { cardId } = c.req.valid('param');
    const card = await c.get('cardRepository').get(cardId);

    if (card == null) {
      throw new CardNotFound(c);
    }

    const [details] = await serializeOwnedCardDetails(c, [card]);

    if (details == null) {
      throw new CardNotFound(c);
    }

    return c.json(details, CONTENTFUL_STATUS_CODES.OK);
  },
});
