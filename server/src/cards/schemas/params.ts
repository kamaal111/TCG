import { z } from 'zod';

import { CardCoreFieldsSchema, CardIdSchema } from './fields.ts';
import { CARD_GAMES } from '../../db/schema/cards.ts';
import { decodeCardCursor } from '../utils/pagination.ts';

export const CardIdParamsSchema = z.object({
  cardId: CardIdSchema.meta({
    description: 'Unique card entry identifier',
    example: '550e8400-e29b-41d4-a716-446655440000',
  }),
});

export const CardsPaginationQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50).meta({
    description: 'Maximum cards per page; defaults to 50 and cannot exceed 100',
    example: 50,
  }),
  cursor: z
    .string()
    .min(1)
    .max(256)
    .regex(/^[A-Za-z0-9_-]+$/)
    .transform((value, context) => {
      const cursor = decodeCardCursor(value);

      if (cursor == null) {
        context.addIssue({ code: 'custom', message: 'Invalid pagination cursor' });

        return z.NEVER;
      }

      return cursor;
    })
    .optional()
    .meta({
      type: 'string',
      description: 'Opaque next_cursor from the preceding page; omit to start at the newest card',
      example:
        'eyJjcmVhdGVkQXQiOiIyMDI2LTA3LTIwVDEwOjMwOjAwLjAwMDAwMFoiLCJpZCI6IjU1MGU4NDAwLWUyOWItNDFkNC1hNzE2LTQ0NjY1NTQ0MDAwMCJ9',
    }),
});

export type CardsPaginationQuery = z.infer<typeof CardsPaginationQuerySchema>;

export const CardsListQuerySchema = CardsPaginationQuerySchema.extend({
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
