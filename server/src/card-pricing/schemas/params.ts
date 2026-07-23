import { z } from '@hono/zod-openapi';

import { CARD_GAMES } from '../../db/schema/cards.ts';

export const PricingSearchQuerySchema = z.object({
  game: z.enum(CARD_GAMES).openapi({ description: 'Trading card game to search', example: 'pokemon' }),
  query: z
    .string()
    .trim()
    .min(2)
    .max(200)
    .openapi({ description: 'Card name, ideally including its card number', example: 'Charizard ex 199' }),
});

export const OwnedPricingQuerySchema = z.object({
  game: z.enum(CARD_GAMES).optional().openapi({ description: 'Optional game filter', example: 'one_piece' }),
});
