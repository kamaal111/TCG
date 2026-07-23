import { z } from '@hono/zod-openapi';

import { CardIdSchema } from './fields.ts';
import { CARD_GAMES } from '../../db/schema/cards.ts';

export const CardIdParamsSchema = z.object({
  cardId: CardIdSchema.openapi({
    description: 'Unique card entry identifier',
    example: '550e8400-e29b-41d4-a716-446655440000',
    param: { name: 'cardId', in: 'path' },
  }),
});

export const CardsListQuerySchema = z.object({
  game: z.enum(CARD_GAMES).optional().openapi({ description: 'Optional game filter', example: 'one_piece' }),
});

export type CardGame = z.infer<typeof CardsListQuerySchema>['game'];
