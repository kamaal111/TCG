import assert from 'node:assert/strict';

import { ScrydexRawCardSchema } from '@tcg/scrydex';

import { normalizeScrydexCard } from '../scrydex/normalize.ts';
import { StaticScrydexClient } from '../scrydex/static-client.ts';

describe('StaticScrydexClient', () => {
  it('searches known illustrators without inventing unknown matches', async () => {
    const client = new StaticScrydexClient();
    const known = await client.searchCards('pokemon', 'Akira Egawa', { searchBy: 'illustrator', languages: [] }, 1);
    assert(known.isOk());
    const unknown = await client.searchCards('pokemon', 'Nobody', { searchBy: 'illustrator', languages: [] }, 1);
    assert(unknown.isOk());
    expect(known.value.records.map(record => record.card.pricing.illustrator)).toEqual(['Akira Egawa']);
    expect(unknown.value.records).toEqual([]);
  });

  it.each([null, '', '   ', 42, { name: 'Arita' }])(
    'ignores malformed or empty artist %j without rejecting the card',
    artist => {
      const raw = ScrydexRawCardSchema.parse({ id: 'base1-4', name: 'Charizard', number: '4', artist });
      expect(normalizeScrydexCard('pokemon', raw)?.card).toMatchObject({ name: 'Charizard', pricing: {} });
      expect(normalizeScrydexCard('pokemon', raw)?.card.pricing.illustrator).toBeUndefined();
    },
  );

  it('returns normalized Pokémon Near Mint pricing', async () => {
    const result = await new StaticScrydexClient().searchCards(
      'pokemon',
      'Giratina VSTAR GG69',
      {
        languages: [],
        searchBy: 'card',
      },
      1,
    );

    assert(result.isOk());

    expect(result.value.records[0]?.card).toMatchObject({
      id: 'crown-zenith-GG69',
      name: 'Giratina VSTAR',
      cardNumber: 'GG69',
      pricing: {
        market: {
          condition: 'near_mint',
          currency: 'USD',
          low: 146.69,
          market: 172.42,
          trend7d: { priceChange: 7.36, percentChange: 4.46 },
        },
      },
    });
  });

  it('finds One Piece cards by printed number', async () => {
    const result = await new StaticScrydexClient().searchCards(
      'one_piece',
      'OP14-069',
      {
        languages: [],
        searchBy: 'card',
      },
      1,
    );

    assert(result.isOk());

    expect(result.value.records[0]?.card).toMatchObject({ id: 'OP14-069', cardNumber: 'OP14-069' });
  });

  it('does not price alternate-only One Piece cards', () => {
    const raw = ScrydexRawCardSchema.parse({
      id: 'OP13-118',
      name: 'Monkey.D.Luffy',
      number: '118',
      printed_number: 'OP13-118',
      variants: [
        {
          name: 'mangaAltArt',
          prices: [{ condition: 'NM', type: 'raw', currency: 'USD', low: 20_000, market: 8_566.65 }],
        },
      ],
    });

    expect(normalizeScrydexCard('one_piece', raw)).toEqual({
      hasBaseVariant: false,
      card: {
        id: 'OP13-118',
        name: 'Monkey.D.Luffy',
        cardNumber: 'OP13-118',
        pricing: {},
      },
    });
  });

  it('recognizes the documented Pokémon unlimited base printing', () => {
    const raw = ScrydexRawCardSchema.parse({
      id: 'base1-4',
      name: 'Charizard',
      number: '4',
      variants: [
        {
          name: 'unlimitedHolofoil',
          prices: [{ condition: 'NM', type: 'raw', currency: 'JPY', low: 1000, market: 1200 }],
        },
        {
          name: 'firstEditionShadowlessHolofoil',
          prices: [{ condition: 'NM', type: 'raw', currency: 'USD', low: 20_000, market: 25_000 }],
        },
      ],
    });

    expect(normalizeScrydexCard('pokemon', raw)?.card.pricing.market).toEqual({
      condition: 'near_mint',
      currency: 'JPY',
      low: 1000,
      market: 1200,
    });
  });

  it('returns deterministic synthetic pricing for unknown cards', async () => {
    const client = new StaticScrydexClient();
    const first = await client.searchCards('one_piece', 'Nami OP01-016', { languages: [], searchBy: 'card' }, 1);
    const second = await client.searchCards('one_piece', 'Nami OP01-016', { languages: [], searchBy: 'card' }, 1);
    assert(first.isOk());
    assert(second.isOk());

    expect(first.value).toEqual(second.value);
    expect(first.value.records[0]?.card).toMatchObject({ name: 'Nami', cardNumber: 'OP01-016' });
  });

  it('models an empty provider result without external I/O', async () => {
    const result = await new StaticScrydexClient().searchCards(
      'pokemon',
      'no results',
      {
        languages: [],
        searchBy: 'card',
      },
      1,
    );

    assert(result.isOk());

    expect(result.value).toEqual({
      records: [],
      providerResultCount: 0,
      hasMore: false,
      rejectedCount: 0,
      missingBaseVariantCount: 0,
    });
  });
});
