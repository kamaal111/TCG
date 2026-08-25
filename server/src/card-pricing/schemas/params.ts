import { z } from 'zod';

import { CARD_GAMES } from '../../db/schema/cards.ts';

export type PricingSearchQuery = z.infer<typeof PricingSearchQuerySchema>;

export const PricingSearchQuerySchema = z.object({
  game: z.enum(CARD_GAMES).meta({ description: 'Trading card game to search', example: 'pokemon' }),
  query: z
    .string()
    .trim()
    .min(2)
    .max(200)
    .meta({ description: 'Card name, ideally including its card number', example: 'Charizard ex 199' }),
});
