import { z } from '@hono/zod-openapi';

import { CARD_CONDITIONS, CARD_GAMES } from '../../db/schema/cards.ts';
import { ApiCommonDatetimeShape } from '../../schemas/common.ts';

export type Card = z.infer<typeof CardSchema>;

export type CardsListResponse = z.infer<typeof CardsListResponseSchema>;

export type DeleteCardResponse = z.infer<typeof DeleteCardResponseSchema>;

export const CardConditionQuantitySchema = z
  .object({
    condition: z.enum(CARD_CONDITIONS).openapi({
      description: 'Physical condition of the copies',
      example: 'near_mint',
    }),
    quantity: z.number().int().openapi({
      description: 'Number of copies owned in this condition',
      example: 2,
    }),
  })
  .openapi('CardConditionQuantity', {
    title: 'Card Condition Quantity',
    description: 'Owned quantity of a card in a specific condition',
    example: { condition: 'near_mint', quantity: 2 },
  });

export const CardSchema = z
  .object({
    id: z.string().nonempty().openapi({
      description: 'Unique identifier of the card entry',
      example: '550e8400-e29b-41d4-a716-446655440000',
    }),
    game: z.enum(CARD_GAMES).openapi({
      description: 'Trading card game the card belongs to',
      example: 'one_piece',
    }),
    name: z.string().openapi({
      description: 'Card name',
      example: 'Monkey D. Luffy',
    }),
    set_name: z.string().openapi({
      description: 'Name of the set the card was printed in',
      example: 'Romance Dawn',
    }),
    card_number: z.string().openapi({
      description: 'Collector number of the card within its set',
      example: 'OP01-003',
    }),
    notes: z.string().nullable().openapi({
      description: 'Free-form notes about the owned copies',
      example: 'First edition',
    }),
    quantities: z.array(CardConditionQuantitySchema).openapi({
      description: 'Owned quantities per condition',
    }),
    created_at: ApiCommonDatetimeShape.openapi({
      description: 'Timestamp when the card entry was created',
      example: '2026-07-07T10:30:00.000Z',
    }),
    updated_at: ApiCommonDatetimeShape.openapi({
      description: 'Timestamp when the card entry was last updated',
      example: '2026-07-07T10:30:00.000Z',
    }),
  })
  .openapi('Card', {
    title: 'Card',
    description: 'An owned card entry with quantities per condition',
    example: {
      id: '550e8400-e29b-41d4-a716-446655440000',
      game: 'one_piece',
      name: 'Monkey D. Luffy',
      set_name: 'Romance Dawn',
      card_number: 'OP01-003',
      notes: null,
      quantities: [
        { condition: 'near_mint', quantity: 2 },
        { condition: 'played', quantity: 1 },
      ],
      created_at: '2026-07-07T10:30:00.000Z',
      updated_at: '2026-07-07T10:30:00.000Z',
    },
  });

export const CardsListResponseSchema = z
  .object({
    cards: z.array(CardSchema).openapi({
      description: 'Owned card entries ordered by newest first',
    }),
  })
  .openapi('CardsListResponse', {
    title: 'Cards List Response',
    description: "The authenticated user's owned card entries ordered by newest first",
  });

export const DeleteCardResponseSchema = z
  .object({})
  .openapi('DeleteCardResponse', { title: 'Delete Card Response', description: 'Successful card deletion response' });
