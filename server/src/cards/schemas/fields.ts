import { z } from '@hono/zod-openapi';

import { CARD_CONDITIONS, CARD_GAMES } from '../../db/schema/cards.ts';

export const CardIdSchema = z.uuid();

export const CardCoreFieldsSchema = z.object({
  game: z.enum(CARD_GAMES).openapi({ description: 'Trading card game', example: 'one_piece' }),
  name: z.string().min(1).max(200).openapi({ description: 'Card name', example: 'Monkey D. Luffy' }),
  set_name: z.string().min(1).max(200).openapi({ description: 'Set name', example: 'Romance Dawn' }),
  card_number: z.string().min(1).max(50).openapi({ description: 'Card number', example: 'OP01-003' }),
});

export const CardConditionQuantitySchema = z
  .object({
    condition: z.enum(CARD_CONDITIONS).openapi({ description: 'Condition of the owned copies', example: 'near_mint' }),
    quantity: z
      .number()
      .int()
      .min(1)
      .max(999)
      .openapi({ description: 'Number of copies owned in this condition', example: 2 }),
  })
  .openapi('CardConditionQuantity', {
    title: 'Card Condition Quantity',
    description: 'Quantity owned for one card condition',
    example: { condition: 'near_mint', quantity: 2 },
  });
