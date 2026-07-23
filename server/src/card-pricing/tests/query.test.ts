import { buildScrydexQuery } from '../scrydex/query.ts';
import { buildSearchQuery, normalizeCardNumber, normalizeName, queryKey } from '../utils/query.ts';

describe('card pricing query utilities', () => {
  it('normalizes card names and numbers without removing hyphens', () => {
    expect(normalizeName('  Marshall.D.Teach   Alt  ')).toBe('Marshall.D.Teach Alt');
    expect(normalizeCardNumber(' op09-093 ')).toBe('OP09-093');
    expect(buildSearchQuery('  Charizard ex ', ' 199 ')).toBe('Charizard ex 199');
    expect(queryKey('pokemon', '  Charizard   EX 199 ')).toBe('pokemon|charizard ex 199');
  });

  it('builds exact Scrydex card-number searches', () => {
    expect(buildScrydexQuery('one_piece', 'OP14-069')).toBe('!id:OP14-069');
    expect(buildScrydexQuery('pokemon', 'Charizard ex 199')).toBe('name:"Charizard ex" AND !number:199');
  });

  it('escapes reserved Scrydex search characters', () => {
    expect(buildScrydexQuery('pokemon', 'Pikachu (V)')).toBe('name:"Pikachu \\(V\\)"');
  });
});
