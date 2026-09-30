import type { CardGame } from '../types.ts';
import { CARD_GAME_MAP } from '../types.ts';

const ONE_PIECE_CARD_NUMBER = /^[A-Z]{2}\d{2}-\d{3}$/i;

const POKEMON_EXPANSION_ID = /^[a-z]{1,4}\d[a-z0-9]*(?:_[a-z]{2})?$/i;

const NUMERIC_CARD_NUMBER = /^\d+$/;

const PRINTED_CARD_NUMBER = /^\d+\/\d+$/;

const RESERVED_CHARACTERS = /([+\-!(){}[\]^"~*?:\\/]|&&|\|\|)/g;

export function buildScrydexQuery(game: CardGame, query: string): string {
  const normalized = query.trim().replace(/\s+/g, ' ');

  if (game === CARD_GAME_MAP.ONE_PIECE && ONE_PIECE_CARD_NUMBER.test(normalized)) {
    return `!id:${normalized.toUpperCase()}`;
  }

  const terms = normalized.split(' ');
  const lastTerm = terms.at(-1);
  const hasCardNumber = lastTerm != null && /\d/.test(lastTerm);

  const expansionId = terms[0];

  if (
    game === CARD_GAME_MAP.POKEMON &&
    terms.length === 2 &&
    expansionId != null &&
    POKEMON_EXPANSION_ID.test(expansionId) &&
    lastTerm != null &&
    (NUMERIC_CARD_NUMBER.test(lastTerm) || PRINTED_CARD_NUMBER.test(lastTerm))
  ) {
    const id = expansionId.toLowerCase();

    const expansionQuery = /_[a-z]{2}$/.test(id)
      ? `!expansion.id:${id}`
      : `(!expansion.id:${id} OR !expansion.id:${id}_ja)`;

    return `${expansionQuery} AND ${pokemonNumberQuery(lastTerm)}`;
  }

  if (!hasCardNumber) {
    return `name:"${escapeScrydexValue(normalized)}"`;
  }

  const name = terms.slice(0, -1).join(' ');
  const numberField = game === CARD_GAME_MAP.ONE_PIECE ? 'id' : 'number';
  const number = game === CARD_GAME_MAP.ONE_PIECE ? lastTerm.toUpperCase() : lastTerm;

  const numberQuery =
    game === CARD_GAME_MAP.POKEMON ? pokemonNumberQuery(number) : `!${numberField}:${escapeScrydexValue(number)}`;

  if (name.length === 0) {
    return numberQuery;
  }

  return `name:"${escapeScrydexValue(name)}" AND ${numberQuery}`;
}

function pokemonNumberQuery(number: string): string {
  if (PRINTED_CARD_NUMBER.test(number)) {
    return `!printed_number:"${number}"`;
  }

  const normalized = NUMERIC_CARD_NUMBER.test(number) ? number.replace(/^0+(?=\d)/, '') : number;

  return `!number:${escapeScrydexValue(normalized)}`;
}

function escapeScrydexValue(value: string): string {
  return value.replace(RESERVED_CHARACTERS, '\\$1');
}
