import { normalizeCardLanguages } from '../languages.ts';
import type { PricingSearchOptions } from '../types.ts';
import type { CardGame } from '../types.ts';
import { CARD_GAME_MAP } from '../types.ts';

const ONE_PIECE_CARD_NUMBER = /^(?:[A-Z]{2}\d{2}|P)-\d{3}$/i;

const POKEMON_EXPANSION_ID = /^(?:[a-z]{1,4}\d[a-z0-9]*|mep)(?:_[a-z]{2})?$/i;

const NUMERIC_CARD_NUMBER = /^\d+$/;

const PRINTED_CARD_NUMBER = /^[A-Z]*\d+\/[A-Z]*\d+$/i;

const SET_SUFFIX_CARD_NUMBER = /^([A-Z]*\d+)\/([A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*)$/;

const PROMO_EXPANSION_BY_SUFFIX = new Map([
  ['ADV-P', 'advp_ja'],
  ['PCG-P', 'pcgp_ja'],
  ['DP-P', 'dpp_ja'],
  ['DPT-P', 'ptp_ja'],
  ['L-P', 'lp_ja'],
  ['BW-P', 'bwp_ja'],
  ['XY-P', 'xyp_ja'],
  ['SM-P', 'smp_ja'],
  ['S-P', 'swshp_ja'],
  ['SV-P', 'svp_ja'],
  ['M-P', 'mp_ja'],
]);

const PROMO_EXPANSION_IDS = new Set(PROMO_EXPANSION_BY_SUFFIX.values());

const RESERVED_CHARACTERS = /([+\-!(){}[\]^"~*?:\\/]|&&|\|\|)/g;

const CARD_NAME_SEPARATOR = /(?<=[\p{L}\p{N}\p{M}])([ ‐‑-])(?=[\p{L}\p{N}\p{M}])/u;

const MAX_CARD_NAME_PHRASES = 8;

const MAX_ENCODED_CARD_NAME_LENGTH = 3500;

export function buildScrydexQuery(game: CardGame, query: string, options: PricingSearchOptions): string {
  const search =
    options.searchBy === 'illustrator'
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

  const expansionId = terms[0]?.toLowerCase();
  const hasSetSuffix = lastTerm != null && SET_SUFFIX_CARD_NUMBER.test(lastTerm.toUpperCase());

  if (
    game === CARD_GAME_MAP.POKEMON &&
    terms.length === 2 &&
    expansionId != null &&
    lastTerm != null &&
    (POKEMON_EXPANSION_ID.test(expansionId) || (hasSetSuffix && PROMO_EXPANSION_IDS.has(expansionId))) &&
    (NUMERIC_CARD_NUMBER.test(lastTerm) || PRINTED_CARD_NUMBER.test(lastTerm) || hasSetSuffix)
  ) {
    const expansionQuery = /_[a-z]{2}$/.test(expansionId)
      ? `!expansion.id:${expansionId}`
      : `(!expansion.id:${expansionId} OR !expansion.id:${expansionId}_ja)`;

    return `${expansionQuery} AND ${pokemonNumberQuery(lastTerm)}`;
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

    if (new URLSearchParams({ q: grouped }).toString().length > MAX_ENCODED_CARD_NAME_LENGTH) {
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
  const uppercased = number.toUpperCase();

  if (PRINTED_CARD_NUMBER.test(number)) {
    return `!printed_number:"${uppercased}"`;
  }

  const [, collectorNumber, suffix] = SET_SUFFIX_CARD_NUMBER.exec(uppercased) ?? [];

  if (collectorNumber != null && suffix != null) {
    const printedQuery = `!printed_number:"${uppercased}"`;
    const expansionId = PROMO_EXPANSION_BY_SUFFIX.get(suffix);

    return expansionId == null
      ? printedQuery
      : `(${printedQuery} OR (!expansion.id:${expansionId} AND ${pokemonCollectorNumberQuery(collectorNumber)}))`;
  }

  return pokemonCollectorNumberQuery(number);
}

function pokemonCollectorNumberQuery(number: string): string {
  const normalized = NUMERIC_CARD_NUMBER.test(number) ? number.replace(/^0+(?=\d)/, '') : number;

  return `!number:${escapeScrydexValue(normalized)}`;
}

function escapeScrydexValue(value: string): string {
  return value.replace(RESERVED_CHARACTERS, '\\$1');
}
