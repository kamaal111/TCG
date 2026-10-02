import { z } from 'zod';

import { CARD_GAMES } from '../../db/schema/cards.ts';
import { CardLanguageSchema, SUPPORTED_CARD_LANGUAGES } from '../languages.ts';

export type PricingSearchQuery = z.infer<typeof PricingSearchQuerySchema>;

export const PricingSearchQuerySchema = z
  .object({
    languages: z.string().optional().meta({
      description:
        'Comma-separated language codes: en, ja for Pokémon; en for One Piece. Empty or all supported languages means unrestricted.',
      example: 'ja',
    }),
    game: z.enum(CARD_GAMES).meta({ description: 'Trading card game to search', example: 'pokemon' }),
    query: z
      .string()
      .trim()
      .min(2)
      .max(200)
      .meta({ description: 'Card name, ideally including its card number', example: 'Charizard ex 199' }),
  })
  .superRefine(({ game, languages }, ctx) => {
    if (languages == null || languages.trim() === '') {
      return;
    }

    for (const value of languages.split(',').map(code => code.trim())) {
      const parsed = CardLanguageSchema.safeParse(value);

      if (!parsed.success || !SUPPORTED_CARD_LANGUAGES[game].includes(parsed.data)) {
        ctx.addIssue({ code: 'custom', path: ['languages'], message: 'Unsupported language for the selected game' });
      }
    }
  });
