import { z } from '@hono/zod-openapi';

import { CARD_CONDITIONS, CARD_GAMES } from '../../db/schema/cards.ts';

export type UpsertCard = z.infer<typeof UpsertCardSchema>;

const CardConditionQuantityInputSchema = z.object({
  condition: z.enum(CARD_CONDITIONS).openapi({
    description: 'Physical condition of the copies',
    example: 'near_mint',
  }),
  quantity: z.number().int().min(1).max(999).openapi({
    description: 'Number of copies owned in this condition',
    example: 2,
  }),
});

export const UpsertCardSchema = z
  .object({
    game: z.enum(CARD_GAMES).openapi({
      description: 'Trading card game the card belongs to',
      example: 'one_piece',
    }),
    name: z.string().min(1).max(200).openapi({
      description: 'Card name',
      example: 'Monkey D. Luffy',
    }),
    set_name: z.string().min(1).max(200).openapi({
      description: 'Name of the set the card was printed in',
      example: 'Romance Dawn',
    }),
    card_number: z.string().min(1).max(50).openapi({
      description: 'Collector number of the card within its set',
      example: 'OP01-003',
    }),
    notes: z.string().max(2000).optional().openapi({
      description: 'Optional free-form notes about the owned copies',
      example: 'First edition',
    }),
    quantities: z
      .array(CardConditionQuantityInputSchema)
      .min(1)
      .max(CARD_CONDITIONS.length)
      .refine(quantities => new Set(quantities.map(quantity => quantity.condition)).size === quantities.length, {
        message: 'Conditions must be unique',
      })
      .openapi({
        description: 'Owned quantities per condition; conditions must be unique',
        example: [{ condition: 'near_mint', quantity: 2 }],
      }),
  })
  .openapi('UpsertCard', {
    title: 'Upsert Card',
    description: 'Request body for creating or fully replacing an owned card entry',
    example: {
      game: 'one_piece',
      name: 'Monkey D. Luffy',
      set_name: 'Romance Dawn',
      card_number: 'OP01-003',
      quantities: [
        { condition: 'near_mint', quantity: 2 },
        { condition: 'played', quantity: 1 },
      ],
    },
  });
