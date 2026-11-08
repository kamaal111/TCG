import { z } from 'zod';

import { CARD_GAMES } from '../../cards/types.ts';
import { CardLanguageSchema, SUPPORTED_CARD_LANGUAGES } from '../languages.ts';

export type PricingSearchQuery = z.infer<typeof PricingSearchQuerySchema>;

export const PricingSearchQuerySchema = z
  .object({
    search_by: z
      .enum(['card', 'illustrator'])
      .meta({ description: 'Search card names/numbers, or illustrator names for Pokémon only' }),
    languages: z.string().optional().meta({
      description:
        'Comma-separated language codes: en, ja for Pokémon; en for One Piece. Empty or all supported languages means unrestricted.',
      example: 'ja',
    }),
    game: z.enum(CARD_GAMES).meta({ description: 'Trading card game to search', example: 'pokemon' }),
    query: z.string().trim().min(2).max(200).meta({
      description: 'Card name/number, or illustrator name when search_by=illustrator',
      example: 'Charizard ex 199',
    }),
  })
  .superRefine(({ game, languages, search_by }, ctx) => {
    if (search_by === 'illustrator' && game !== 'pokemon') {
      ctx.addIssue({
        code: 'custom',
        path: ['search_by'],
        message: 'Illustrator search is only supported for Pokémon',
      });
    }

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
