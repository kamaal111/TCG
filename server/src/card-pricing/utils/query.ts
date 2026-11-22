import { toISO8601String } from '../../utils/strings.ts';
import { normalizeCardLanguages } from '../languages.ts';
import { CARD_GAME_MAP, type CardGame, type PricingSearchOptions } from '../types.ts';

export function normalizeCardNumber(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ').toUpperCase();
}

export function normalizeName(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ');
}

export function buildSearchQuery(name: string, cardNumber: string): string {
  return normalizeName(`${normalizeName(name)} ${normalizeCardNumber(cardNumber)}`);
}

export function queryKey(game: CardGame, query: string, options: PricingSearchOptions): string {
  const cardVersion = game === CARD_GAME_MAP.POKEMON ? 'v5' : 'v4';
  const version = options.searchBy === 'illustrator' ? 'illustrator-v1' : cardVersion;

  const selected = normalizeCardLanguages(game, options.languages);
  const normalized = normalizeName(query).toLowerCase().replaceAll('%', '%25').replaceAll('|', '%7C');

  return selected.length === 0
    ? `${game}|${version}|${normalized}`
    : `${game}|${version}|languages-v1|${selected.join(',')}|${normalized}`;
}

export function todayUTC(): string {
  return toISO8601String(new Date()).slice(0, 10);
}
