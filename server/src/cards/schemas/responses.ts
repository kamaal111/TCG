import { z } from '@hono/zod-openapi';

import { ApiCommonDatetimeShape } from '../../schemas/common.ts';
import { CardConditionQuantitySchema, CardCoreFieldsSchema, CardIdSchema } from './fields.ts';

export const CardSchema = CardCoreFieldsSchema.extend({
  id: CardIdSchema.openapi({
    description: 'Unique card entry identifier',
    example: '550e8400-e29b-41d4-a716-446655440000',
  }),
  notes: z.string().max(2000).nullable().openapi({ description: 'Optional notes', example: 'Alternate art' }),
  quantities: z.array(CardConditionQuantitySchema).openapi({ description: 'Owned quantities by condition' }),
  created_at: ApiCommonDatetimeShape.openapi({
    description: 'Creation timestamp',
    example: '2026-07-20T10:30:00.000Z',
  }),
  updated_at: ApiCommonDatetimeShape.openapi({
    description: 'Last update timestamp',
    example: '2026-07-20T10:30:00.000Z',
  }),
}).openapi('Card', {
  title: 'Card',
  description: 'An owned trading card entry',
  example: {
    id: '550e8400-e29b-41d4-a716-446655440000',
    game: 'one_piece',
    name: 'Monkey D. Luffy',
    set_name: 'Romance Dawn',
    card_number: 'OP01-003',
    notes: null,
    quantities: [{ condition: 'near_mint', quantity: 2 }],
    created_at: '2026-07-20T10:30:00.000Z',
    updated_at: '2026-07-20T10:30:00.000Z',
  },
});

export const CardsListResponseSchema = z
  .object({ cards: z.array(CardSchema).openapi({ description: 'Owned card entries, newest first' }) })
  .openapi('CardsListResponse', {
    title: 'Cards List Response',
    description: "The authenticated user's card collection",
    example: { cards: [] },
  });

export const DeleteCardResponseSchema = z.object({}).openapi('DeleteCardResponse', {
  title: 'Delete Card Response',
  description: 'Confirms that the card entry was deleted',
  example: {},
});

export type CardResponse = z.infer<typeof CardSchema>;
export type CardsListResponse = z.infer<typeof CardsListResponseSchema>;
export type DeleteCardResponse = z.infer<typeof DeleteCardResponseSchema>;
