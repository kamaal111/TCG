import type { CardGame, TCGGORawCard } from '../tcggo/types.ts';

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

export function matchCard(
  cards: TCGGORawCard[],
  name: string,
  cardNumber: string,
): { card: TCGGORawCard; confidence: 'card_number' | 'name' } | null {
  const normalizedNumber = normalizeCardNumber(cardNumber);
  const cardNumberMatch = cards.find(
    candidate =>
      typeof candidate.card_number === 'string' && normalizeCardNumber(candidate.card_number) === normalizedNumber,
  );
  if (cardNumberMatch != null) return { card: cardNumberMatch, confidence: 'card_number' };

  const normalizedName = normalizeName(name).toLowerCase();
  const nameMatch = cards.find(
    candidate => typeof candidate.name === 'string' && normalizeName(candidate.name).toLowerCase() === normalizedName,
  );
  return nameMatch == null ? null : { card: nameMatch, confidence: 'name' };
}

export function todayUTC(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}
