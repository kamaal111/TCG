import { toISO8601String } from '../../utils/strings.ts';
import { normalizeCardLanguages, type CardLanguage } from '../languages.ts';
import type { CardGame } from '../types.ts';

export function normalizeCardNumber(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ').toUpperCase();
}

export function normalizeName(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ');
}

export function buildSearchQuery(name: string, cardNumber: string): string {
  return normalizeName(`${normalizeName(name)} ${normalizeCardNumber(cardNumber)}`);
}

export function queryKey(game: CardGame, query: string, languages: readonly CardLanguage[] = []): string {
  const version = game === 'pokemon' ? 'v2|' : '';

  const selected = normalizeCardLanguages(game, languages);
  const normalized = normalizeName(query).toLowerCase();

  return selected.length === 0
    ? `${game}|${version}${normalized}`
    : `${game}|languages-v1|${selected.join(',')}|${normalized}`;
}

export function todayUTC(): string {
  return toISO8601String(new Date()).slice(0, 10);
}
