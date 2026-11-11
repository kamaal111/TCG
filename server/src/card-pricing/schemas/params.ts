import { z } from 'zod';

import { CARD_GAMES } from '../../cards/types.ts';
import { CardLanguageSchema, parseCardLanguages, SUPPORTED_CARD_LANGUAGES } from '../languages.ts';
import { decodeSearchCursor, searchCursorIdentity } from '../utils/pagination.ts';
import { queryKey } from '../utils/query.ts';

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
    cursor: z
      .string()
      .transform((value, ctx) => {
        const cursor = decodeSearchCursor(value);

        if (cursor == null) {
          ctx.addIssue({ code: 'custom', message: 'Invalid pagination cursor' });

          return z.NEVER;
        }

        return cursor;
      })
      .optional()
      .meta({
        type: 'string',
        description: 'Opaque next_cursor from the preceding page for the same search. Omit for the first page.',
      }),
    game: z.enum(CARD_GAMES).meta({ description: 'Trading card game to search', example: 'pokemon' }),
    query: z.string().trim().min(2).max(200).meta({
      description: 'Card name/number, or illustrator name when search_by=illustrator',
      example: 'Charizard ex 199',
    }),
  })
  .superRefine(({ cursor, game, languages, query, search_by }, ctx) => {
    if (search_by === 'illustrator' && game !== 'pokemon') {
      ctx.addIssue({
        code: 'custom',
        path: ['search_by'],
        message: 'Illustrator search is only supported for Pokémon',
      });
    }

    const languageCodes = languages?.trim() ? languages.split(',').map(code => code.trim()) : [];

    for (const value of languageCodes) {
      const parsed = CardLanguageSchema.safeParse(value);

      if (!parsed.success || !SUPPORTED_CARD_LANGUAGES[game].includes(parsed.data)) {
        ctx.addIssue({ code: 'custom', path: ['languages'], message: 'Unsupported language for the selected game' });

        return;
      }
    }

    if (cursor != null) {
      const key = queryKey(game, query, { languages: parseCardLanguages(languages), searchBy: search_by });

      if (cursor.identity !== searchCursorIdentity(key)) {
        ctx.addIssue({ code: 'custom', path: ['cursor'], message: 'Invalid pagination cursor for this search' });
      }
    }
  });
