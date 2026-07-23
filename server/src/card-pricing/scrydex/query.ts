import type { CardGame } from '../types.ts';
import { CARD_GAME_MAP } from '../types.ts';

const ONE_PIECE_CARD_NUMBER = /^[A-Z]{2}\d{2}-\d{3}$/i;
const RESERVED_CHARACTERS = /([+\-!(){}[\]^"~*?:\\/]|&&|\|\|)/g;

export function buildScrydexQuery(game: CardGame, query: string): string {
  const normalized = query.trim().replace(/\s+/g, ' ');
  if (game === CARD_GAME_MAP.ONE_PIECE && ONE_PIECE_CARD_NUMBER.test(normalized)) {
    return `!id:${normalized.toUpperCase()}`;
  }

  const terms = normalized.split(' ');
  const lastTerm = terms.at(-1);
  const hasCardNumber = lastTerm != null && /\d/.test(lastTerm);
  if (!hasCardNumber) return `name:"${escapeScrydexValue(normalized)}"`;

  const name = terms.slice(0, -1).join(' ');
  const numberField = game === CARD_GAME_MAP.ONE_PIECE ? 'id' : 'number';
  const number = game === CARD_GAME_MAP.ONE_PIECE ? lastTerm.toUpperCase() : lastTerm;
  if (name.length === 0) return `!${numberField}:${escapeScrydexValue(number)}`;
  return `name:"${escapeScrydexValue(name)}" AND !${numberField}:${escapeScrydexValue(number)}`;
}

function escapeScrydexValue(value: string): string {
  return value.replace(RESERVED_CHARACTERS, '\\$1');
}
