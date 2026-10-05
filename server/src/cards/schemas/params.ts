import { z } from 'zod';

import { CardCoreFieldsSchema, CardIdSchema } from './fields.ts';
import { CARD_GAMES } from '../../db/schema/cards.ts';

export const CardIdParamsSchema = z.object({
  cardId: CardIdSchema.meta({
    description: 'Unique card entry identifier',
    example: '550e8400-e29b-41d4-a716-446655440000',
  }),
});

export const CardsListQuerySchema = z.object({
  game: z.enum(CARD_GAMES).optional().meta({ description: 'Optional game filter', example: 'one_piece' }),
  set_name: z
    .preprocess(value => {
      const single = CardCoreFieldsSchema.shape.set_name.safeParse(value);

      return single.success ? [single.data] : value;
    }, z.array(CardCoreFieldsSchema.shape.set_name).optional())
    .meta({
      type: 'array',
      items: z.toJSONSchema(CardCoreFieldsSchema.shape.set_name),
      description: 'Optional exact set names. Repeat set_name for multiple sets; omitted means all sets.',
      example: ['Base Set', 'Crown Zenith'],
    }),
});

export type CardGame = z.infer<typeof CardsListQuerySchema>['game'];
