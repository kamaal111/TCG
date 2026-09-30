import { buildScrydexQuery } from '../scrydex/query.ts';
import { buildSearchQuery, normalizeCardNumber, normalizeName, queryKey } from '../utils/query.ts';

describe('card pricing query utilities', () => {
  it('normalizes card names and numbers without removing hyphens', () => {
    expect(normalizeName('  Marshall.D.Teach   Alt  ')).toBe('Marshall.D.Teach Alt');
    expect(normalizeCardNumber(' op09-093 ')).toBe('OP09-093');
    expect(buildSearchQuery('  Charizard ex ', ' 199 ')).toBe('Charizard ex 199');
    expect(queryKey('pokemon', '  Charizard   EX 199 ')).toBe('pokemon|v2|charizard ex 199');
  });

  it('builds exact Scrydex card-number searches', () => {
    expect(buildScrydexQuery('one_piece', 'OP14-069')).toBe('!id:OP14-069');
    expect(buildScrydexQuery('pokemon', 'Charizard ex 199')).toBe('name:"Charizard ex" AND !number:199');
  });

  it('escapes reserved Scrydex search characters', () => {
    expect(buildScrydexQuery('pokemon', 'Pikachu (V)')).toBe('name:"Pikachu \\(V\\)"');
  });

  it.each([
    ['sv5m 072/071', '(!expansion.id:sv5m OR !expansion.id:sv5m_ja) AND !printed_number:"072/071"'],
    ['  SV5M   072/071  ', '(!expansion.id:sv5m OR !expansion.id:sv5m_ja) AND !printed_number:"072/071"'],
    ['sv5m_ja 072', '!expansion.id:sv5m_ja AND !number:72'],
    ['sv3pt5 199', '(!expansion.id:sv3pt5 OR !expansion.id:sv3pt5_ja) AND !number:199'],
    ['base1 000', '(!expansion.id:base1 OR !expansion.id:base1_ja) AND !number:0'],
    ['Shiftry 072/071', 'name:"Shiftry" AND !printed_number:"072/071"'],
    ['ダーテング 072', 'name:"ダーテング" AND !number:72'],
    ['072/071', '!printed_number:"072/071"'],
    ['Porygon2 123', 'name:"Porygon2" AND !number:123'],
    ['Giratina VSTAR GG69', 'name:"Giratina VSTAR" AND !number:GG69'],
  ])('translates Pokémon input %s into the expected provider filters', (input, expected) => {
    expect(buildScrydexQuery('pokemon', input)).toBe(expected);
  });

  it('preserves One Piece searches and their cache namespace', () => {
    expect(buildScrydexQuery('one_piece', 'Nami OP01-016')).toBe('name:"Nami" AND !id:OP01\\-016');
    expect(queryKey('one_piece', ' OP14-069 ')).toBe('one_piece|op14-069');
  });
});
