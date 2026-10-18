import { parseCardLanguages, normalizeCardLanguages } from '../languages.ts';
import { PricingSearchQuerySchema } from '../schemas/params.ts';
import { buildScrydexQuery } from '../scrydex/query.ts';
import { buildSearchQuery, normalizeCardNumber, normalizeName, queryKey } from '../utils/query.ts';

describe('card pricing query utilities', () => {
  it.each([
    ['en', ['en']],
    ['ja', ['ja']],
    ['', []],
    [' ja, en,ja ', []],
    ['en,en', ['en']],
  ])('normalizes language selection %s', (value, expected) => {
    expect(normalizeCardLanguages('pokemon', parseCardLanguages(value))).toEqual(expected);
    expect(PricingSearchQuerySchema.safeParse({ game: 'pokemon', query: 'Shiftry', languages: value }).success).toBe(
      true,
    );
  });

  it.each(['fr', 'EN', 'en,', 'en,unknown'])('rejects invalid language selection %s', languages => {
    expect(PricingSearchQuerySchema.safeParse({ game: 'pokemon', query: 'Shiftry', languages }).success).toBe(false);
  });

  it('rejects Japanese for One Piece', () => {
    expect(PricingSearchQuerySchema.safeParse({ game: 'one_piece', query: 'Nami', languages: 'ja' }).success).toBe(
      false,
    );
  });

  it('shares unrestricted cache keys and isolates partial language selections', () => {
    expect(queryKey('pokemon', 'Shiftry', [])).toBe(queryKey('pokemon', 'Shiftry'));
    expect(queryKey('pokemon', 'Shiftry', ['ja', 'en', 'ja'])).toBe(queryKey('pokemon', 'Shiftry'));
    expect(queryKey('pokemon', 'Shiftry', ['en'])).not.toBe(queryKey('pokemon', 'Shiftry', ['ja']));
    expect(queryKey('pokemon', 'Shiftry', ['en', 'en'])).toBe(queryKey('pokemon', 'Shiftry', ['en']));
    expect(queryKey('one_piece', 'Nami', ['en'])).toBe(queryKey('one_piece', 'Nami'));
  });

  it.each([
    ['Shiftry', ['ja'], '(name:"Shiftry") AND (!language_code:JA)'],
    [
      'sv5m 072/071',
      ['en'],
      '((!expansion.id:sv5m OR !expansion.id:sv5m_ja) AND !printed_number:"072/071") AND (!language_code:EN)',
    ],
    ['sv5m_ja 072', ['ja'], '(!expansion.id:sv5m_ja AND !number:72) AND (!language_code:JA)'],
    ['Shiftry', ['ja', 'en'], 'name:"Shiftry"'],
  ])('constrains the complete provider search for %s', (query, languages, expected) => {
    expect(buildScrydexQuery('pokemon', query, parseCardLanguages(languages.join(',')))).toBe(expected);
  });

  it('normalizes card names and numbers without removing hyphens', () => {
    expect(normalizeName('  Marshall.D.Teach   Alt  ')).toBe('Marshall.D.Teach Alt');
    expect(normalizeCardNumber(' op09-093 ')).toBe('OP09-093');
    expect(buildSearchQuery('  Charizard ex ', ' 199 ')).toBe('Charizard ex 199');
    expect(queryKey('pokemon', '  Charizard   EX 199 ')).toBe('pokemon|v3|charizard ex 199');
  });

  it('builds exact Scrydex card-number searches', () => {
    expect(buildScrydexQuery('one_piece', 'OP14-069')).toBe('!id:OP14-069');
    expect(buildScrydexQuery('pokemon', 'Charizard ex 199')).toBe('name:"Charizard ex" AND !number:199');
  });

  it.each([
    ['p-110', '!id:P-110'],
    [' P-110 ', '!id:P-110'],
    ['Monkey.D.Luffy P-110', 'name:"Monkey.D.Luffy" AND !id:P-110'],
    ['  Monkey.D.Luffy   p-110  ', 'name:"Monkey.D.Luffy" AND !id:P-110'],
    ['Nami OP01-016', 'name:"Nami" AND !id:OP01-016'],
    ['Luffy (Promo) P-110', 'name:"Luffy \\(Promo\\)" AND !id:P-110'],
    ['P-110*', '!id:P\\-110\\*'],
  ])('builds safe One Piece number queries for %s', (input, expected) => {
    expect(buildScrydexQuery('one_piece', input)).toBe(expected);
  });

  it('versions One Piece searches while sharing normalized promo cache keys', () => {
    expect(queryKey('one_piece', 'p-110')).toBe('one_piece|v2|p-110');
    expect(queryKey('one_piece', ' P-110 ', ['en'])).toBe(queryKey('one_piece', 'p-110'));
    expect(queryKey('one_piece', ' Monkey.D.Luffy   P-110 ')).toBe('one_piece|v2|monkey.d.luffy p-110');
  });

  it('versions unrestricted and language-filtered Pokémon promo cache keys', () => {
    expect(queryKey('pokemon', ' MEP   056 ')).toBe('pokemon|v3|mep 056');
    expect(queryKey('pokemon', 'mep 056', ['en'])).toBe('pokemon|v3|languages-v1|en|mep 056');
  });

  it('escapes reserved Scrydex search characters', () => {
    expect(buildScrydexQuery('pokemon', 'Pikachu (V)')).toBe('name:"Pikachu \\(V\\)"');
  });

  it.each([
    ['mep 056', '(!expansion.id:mep OR !expansion.id:mep_ja) AND !number:56'],
    [' MEP   056 ', '(!expansion.id:mep OR !expansion.id:mep_ja) AND !number:56'],
    ['mep_ja 056', '!expansion.id:mep_ja AND !number:56'],
    ['Mew 056', 'name:"Mew" AND !number:56'],
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

  it('preserves standalone One Piece set-number searches with versioned cache keys', () => {
    expect(buildScrydexQuery('one_piece', 'OP14-069')).toBe('!id:OP14-069');
    expect(queryKey('one_piece', ' OP14-069 ')).toBe('one_piece|v2|op14-069');
  });
});
