import { SCRYDEX_SEARCH_PAGE_SIZE } from '@tcg/scrydex';

import { normalizeCardLanguages } from '../languages.ts';
import type { PricingSearchOptions } from '../types.ts';
import type { CardGame } from '../types.ts';
import { CARD_GAME_MAP, PRICING_SEARCH_MODE_MAP } from '../types.ts';
import {
  normalizeCollectorNumber,
  ONE_PIECE_CARD_NUMBER,
  pokemonPrintedNumber,
  pokemonSetAndNumber,
} from '../utils/identifiers.ts';

const RESERVED_CHARACTERS = /([+\-!(){}[\]^"~*?:\\/]|&&|\|\|)/g;

const CARD_NAME_SEPARATOR = /(?<=[\p{L}\p{N}\p{M}])([ ‐‑-])(?=[\p{L}\p{N}\p{M}])/u;

const MAX_CARD_NAME_PHRASES = 8;

const MAX_ENCODED_SCRYDEX_QUERY_LENGTH = 3500;

export function buildScrydexIdBatches(providerIds: readonly string[]) {
  const batches: { query: string; ids: ReadonlySet<string> }[] = [];
  let query = '';
  let ids = new Set<string>();

  for (const id of providerIds) {
    const clause = `!id:${id}`;
    const combined = query.length > 0 ? `${query} OR ${clause}` : clause;

    if (
      ids.size === SCRYDEX_SEARCH_PAGE_SIZE ||
      new URLSearchParams({ q: combined }).toString().length > MAX_ENCODED_SCRYDEX_QUERY_LENGTH
    ) {
      if (new URLSearchParams({ q: clause }).toString().length > MAX_ENCODED_SCRYDEX_QUERY_LENGTH) {
        return undefined;
      }

      batches.push({ query, ids });
      query = clause;
      ids = new Set([id]);
    } else {
      query = combined;
      ids.add(id);
    }
  }

  if (ids.size > 0) {
    batches.push({ query, ids });
  }

  return batches;
}

export function buildScrydexQuery(game: CardGame, query: string, options: PricingSearchOptions): string {
  const search =
    options.searchBy === PRICING_SEARCH_MODE_MAP.ILLUSTRATOR
      ? `artist:"${escapeScrydexValue(query.trim().replace(/\s+/g, ' '))}"`
      : buildCardQuery(game, query);

  const selected = normalizeCardLanguages(game, options.languages);

  if (selected.length === 0) {
    return search;
  }

  const languageQuery = selected.map(code => `!language_code:${code.toUpperCase()}`).join(' OR ');

  return `(${search}) AND (${languageQuery})`;
}

function buildCardQuery(game: CardGame, query: string): string {
  const normalized = query.trim().replace(/\s+/g, ' ');

  const terms = normalized.split(' ');
  const lastTerm = terms.at(-1);
  const hasCardNumber = lastTerm != null && /\d/.test(lastTerm);

  const setAndNumber = game === CARD_GAME_MAP.POKEMON ? pokemonSetAndNumber(terms) : undefined;

  if (setAndNumber != null) {
    const expansions = setAndNumber.expansionIds.map(id => `!expansion.id:${id}`);
    const expansionQuery = expansions.length > 1 ? `(${expansions.join(' OR ')})` : expansions[0];

    return `${expansionQuery} AND ${pokemonNumberQuery(setAndNumber.number)}`;
  }

  if (!hasCardNumber) {
    return cardNameQuery(normalized);
  }

  const name = terms.slice(0, -1).join(' ');

  const numberQuery = game === CARD_GAME_MAP.POKEMON ? pokemonNumberQuery(lastTerm) : onePieceNumberQuery(lastTerm);

  if (name.length === 0) {
    return numberQuery;
  }

  return `${cardNameQuery(name)} AND ${numberQuery}`;
}

function cardNameQuery(name: string): string {
  const parts = name.split(CARD_NAME_SEPARATOR);
  const words = parts.filter((_, index) => index % 2 === 0).map(escapeScrydexValue);
  const separators = parts.filter((_, index) => index % 2 !== 0).map(separator => (separator === ' ' ? ' ' : '-'));

  const phrase = (separators: readonly string[]) => {
    return `name:"${words.map((word, index) => `${separators[index - 1] ?? ''}${word}`).join('')}"`;
  };

  let query = phrase(separators);
  const phrases = new Set([query]);

  for (const alternative of alternateNameSeparators(separators)) {
    const alternatePhrase = phrase(alternative);

    if (phrases.has(alternatePhrase)) {
      continue;
    }

    const grouped = `(${[...phrases, alternatePhrase].join(' OR ')})`;

    if (new URLSearchParams({ q: grouped }).toString().length > MAX_ENCODED_SCRYDEX_QUERY_LENGTH) {
      break;
    }

    query = grouped;
    phrases.add(alternatePhrase);

    if (phrases.size === MAX_CARD_NAME_PHRASES) {
      break;
    }
  }

  return query;
}

function* alternateNameSeparators(separators: readonly string[]): Generator<readonly string[]> {
  if (separators.length <= 3) {
    const combinations = [separators];

    for (const index of separators.keys()) {
      const flipped = combinations.map(combination => flipNameSeparator(combination, index));
      combinations.push(...flipped);
      yield* flipped;
    }

    return;
  }

  yield separators.map(() => ' ');
  yield separators.map(() => '-');

  for (const index of separators.keys()) {
    yield flipNameSeparator(separators, index);
  }
}

function flipNameSeparator(separators: readonly string[], index: number): readonly string[] {
  return separators.with(index, separators[index] === ' ' ? '-' : ' ');
}

function onePieceNumberQuery(number: string): string {
  const normalized = number.toUpperCase();

  return `!id:${ONE_PIECE_CARD_NUMBER.test(normalized) ? normalized : escapeScrydexValue(normalized)}`;
}

function pokemonNumberQuery(number: string): string {
  const printed = pokemonPrintedNumber(number);

  if (printed == null) {
    return pokemonCollectorNumberQuery(number);
  }

  const printedQuery = `!printed_number:"${printed.number}"`;

  return printed.promo?.expansionId != null
    ? `(${printedQuery} OR (!expansion.id:${printed.promo.expansionId} AND ${pokemonCollectorNumberQuery(printed.promo.collectorNumber)}))`
    : printedQuery;
}

function pokemonCollectorNumberQuery(number: string): string {
  return `!number:${escapeScrydexValue(normalizeCollectorNumber(number))}`;
}

export function escapeScrydexValue(value: string): string {
  return value.replace(RESERVED_CHARACTERS, '\\$1');
}
