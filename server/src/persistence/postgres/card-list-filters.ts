import { compactMap } from '@kamaalio/kamaal/arrays';
import { and, eq, ilike, inArray, isNotNull, ne, or, sql, type SQLWrapper } from 'drizzle-orm';

import { CARD_GAME_MAP, type CardGame } from '../../card-pricing/types.ts';
import type { CardListChoices } from '../../cards/list-page.ts';
import { literalSubstringPattern } from '../../utils/search.ts';

type CardListColumns = Readonly<{
  game: SQLWrapper;
  setName: SQLWrapper;
  illustrator: SQLWrapper;
  name: SQLWrapper;
  englishSearchAlias: SQLWrapper;
  cardNumber: SQLWrapper;
}>;

type CardListFilters = Readonly<{
  game?: CardGame;
  setNames: readonly string[];
  illustrators: readonly string[];
  query?: string;
}>;

export function cardListPredicates(columns: CardListColumns, filters: CardListFilters) {
  const pokemon = eq(columns.game, CARD_GAME_MAP.POKEMON);
  const illustrators = [...new Set(filters.illustrators.map(name => name.toLowerCase()))];
  const pattern = filters.query !== undefined ? literalSubstringPattern(filters.query) : undefined;

  return {
    game: filters.game !== undefined ? eq(columns.game, filters.game) : undefined,
    setChoice: ne(columns.setName, ''),
    illustratorChoice: (game: SQLWrapper) => and(eq(game, CARD_GAME_MAP.POKEMON), isNotNull(columns.illustrator)),
    matches: and(
      filters.setNames.length > 0 ? inArray(columns.setName, [...new Set(filters.setNames)]) : undefined,
      illustrators.length > 0 ? and(pokemon, inArray(sql`lower(${columns.illustrator})`, illustrators)) : undefined,
      pattern !== undefined
        ? or(
            ilike(columns.name, pattern),
            ilike(columns.englishSearchAlias, pattern),
            ilike(columns.setName, pattern),
            ilike(columns.cardNumber, pattern),
          )
        : undefined,
    ),
  };
}

type CardListChoiceRow = Readonly<{ name: string | null }>;

export function cardListChoices(sets: CardListChoiceRow[], illustrators: CardListChoiceRow[]): CardListChoices {
  return {
    availableSetNames: choiceNames(sets),
    availableIllustrators: choiceNames(illustrators),
  };
}

function choiceNames(rows: CardListChoiceRow[]): string[] {
  return compactMap(rows, ({ name }) => name);
}
