import { buildSearchQuery, matchCard, normalizeCardNumber, normalizeName, queryKey, todayUTC } from '../utils/query.ts';

describe('card pricing query utilities', () => {
  it('normalizes card names and numbers without removing hyphens', () => {
    expect(normalizeName('  Marshall.D.Teach   Alt  ')).toBe('Marshall.D.Teach Alt');
    expect(normalizeCardNumber(' op09-093 ')).toBe('OP09-093');
    expect(buildSearchQuery('  Charizard ex ', ' 199 ')).toBe('Charizard ex 199');
    expect(queryKey('pokemon', '  Charizard   EX 199 ')).toBe('pokemon|charizard ex 199');
  });

  it('matches an exact card number before an exact card name', () => {
    const cards = [
      { id: 'name', name: 'Charizard ex', card_number: '001' },
      { id: 'number', name: 'Other card', card_number: '199' },
    ];

    expect(matchCard(cards, 'Charizard ex', '199')).toEqual({
      card: cards[1],
      confidence: 'card_number',
    });
  });

  it('falls back to an exact normalized name and reports no match otherwise', () => {
    const card = { id: 'name', name: 'Giratina VSTAR', card_number: 'GG69' };

    expect(matchCard([card], ' giratina   vstar ', 'other')).toEqual({
      card,
      confidence: 'name',
    });
    expect(matchCard([card], 'Pikachu', '58')).toBeNull();
  });

  it('uses the UTC calendar day', () => {
    expect(todayUTC(new Date('2026-07-23T23:59:59.999Z'))).toBe('2026-07-23');
  });
});
