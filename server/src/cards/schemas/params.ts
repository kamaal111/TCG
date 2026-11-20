import { z } from 'zod';

import { CardCoreFieldsSchema } from './fields.ts';
import { CardListFiltersSchema, validateCardListFilters } from './list-filters.ts';
import { UuidSchema } from '../../schemas/common.ts';
import { base64UrlCursorPattern, paginationCursor } from '../../utils/pagination.ts';
import { decodeCardCursor } from '../utils/pagination.ts';

export const CardIdParamsSchema = z.object({
  cardId: UuidSchema.meta({
    description: 'Unique card entry identifier',
    example: '550e8400-e29b-41d4-a716-446655440000',
  }),
});

export const CardsPaginationQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50).meta({
    description: 'Maximum cards per page; defaults to 50 and cannot exceed 100',
    example: 50,
  }),
  cursor: paginationCursor(z.string().nonempty().max(256).regex(base64UrlCursorPattern), decodeCardCursor)
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
  illustrator: CardListFiltersSchema.shape.illustrator,
  collection_id: UuidSchema.optional(),
  query: CardCoreFieldsSchema.shape.name.trim().optional().meta({
    description:
      'Case-insensitive literal substring in card name, English search alias, set name, or card number; omitted means all cards.',
    example: 'Luffy',
  }),
  game: CardListFiltersSchema.shape.game,
  set_name: CardListFiltersSchema.shape.set_name,
}).superRefine(validateCardListFilters);

export type CardGame = z.infer<typeof CardsListQuerySchema>['game'];
