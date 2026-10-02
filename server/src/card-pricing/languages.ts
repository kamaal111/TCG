import { z } from 'zod';

import type { CardGame } from './types.ts';

const LANGUAGES = { ENGLISH: 'en', JAPANESE: 'ja' } as const;

export const CardLanguageSchema = z.enum(Object.values(LANGUAGES));

export type CardLanguage = z.infer<typeof CardLanguageSchema>;

export const SUPPORTED_CARD_LANGUAGES: Record<CardGame, readonly CardLanguage[]> = {
  pokemon: [LANGUAGES.ENGLISH, LANGUAGES.JAPANESE],
  one_piece: [LANGUAGES.ENGLISH],
};

export function parseCardLanguages(value: string | undefined): CardLanguage[] {
  if (value == null) {
    return [];
  }

  return value.trim() === '' ? [] : z.array(CardLanguageSchema).parse(value.split(',').map(code => code.trim()));
}

export function normalizeCardLanguages(game: CardGame, languages: readonly CardLanguage[] = []): CardLanguage[] {
  const selected = [...new Set(languages)].sort();

  if (
    selected.length === SUPPORTED_CARD_LANGUAGES[game].length &&
    SUPPORTED_CARD_LANGUAGES[game].every(code => selected.includes(code))
  ) {
    return [];
  }

  return selected;
}
