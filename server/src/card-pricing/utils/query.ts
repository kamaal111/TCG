import { toISO8601String } from '../../utils/strings.ts';
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

export function queryKey(game: CardGame, query: string): string {
  return `${game}|${normalizeName(query).toLowerCase()}`;
}

export function todayUTC(): string {
  return toISO8601String(new Date()).slice(0, 10);
}
