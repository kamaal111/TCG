import { ScrydexRawCardSchema, ScrydexCardResponseSchema, ScrydexSearchResponseSchema } from '../src/index.ts';

describe('Scrydex provider card schemas', () => {
  it('retains provider fields throughout images, variants, prices, and trends', () => {
    const card = {
      id: 'card',
      name: 'Card',
      number: '7',
      printed_number: '007/100',
      rarity: 'Rare',
      language_code: 'JA',
      extra: 'card',
      expansion: { id: 'set', name: 'Set', extra: 'expansion' },
      images: [{ type: 'front', small: 'small', medium: 'medium', large: 'large', extra: 'image' }],
      variants: [
        {
          name: 'holofoil',
          extra: 'variant',
          images: [{ extra: true }],
          prices: [
            {
              condition: 'NM',
              type: 'raw',
              currency: 'JPY',
              low: 0,
              market: 10,
              extra: 'price',
              trends: {
                extra: 'trends',
                days_7: { price_change: -1, percent_change: -2, extra: '7d' },
                days_30: { price_change: 1, percent_change: 2, extra: '30d' },
              },
            },
          ],
        },
      ],
    };

    expect(ScrydexRawCardSchema.parse(card)).toEqual(card);
  });

  it('accepts absent optional fields and empty nested objects', () => {
    const card = { images: [{}], variants: [{ prices: [{ trends: { days_7: {}, days_30: {} } }] }] };
    expect(ScrydexRawCardSchema.parse(card)).toEqual(card);
    expect(ScrydexRawCardSchema.parse({})).toEqual({});
  });

  it('preserves unknown scalar values for consumer normalization', () => {
    const card = {
      id: 42,
      name: null,
      number: false,
      variants: [
        {
          name: 3,
          images: [{ large: 12 }],
          prices: [
            { currency: 'EUR', low: '10', market: -1, trends: { days_7: { price_change: '1', percent_change: null } } },
          ],
        },
      ],
    };

    expect(ScrydexRawCardSchema.parse(card)).toEqual(card);
  });

  it('trims expansion names while retaining other expansion metadata', () => {
    expect(ScrydexRawCardSchema.parse({ expansion: { id: 'set', name: '  Wild Force  ' } })).toEqual({
      expansion: { id: 'set', name: 'Wild Force' },
    });
  });

  it.each([null, 'invalid', 123, []])('discards malformed optional expansion objects: %j', expansion => {
    expect(ScrydexRawCardSchema.parse({ expansion })).toEqual({ expansion: undefined });
  });

  it.each([123, null, '   '])('discards invalid expansion names without losing other metadata: %j', name => {
    expect(ScrydexRawCardSchema.parse({ expansion: { id: 'set', name } })).toEqual({
      expansion: { id: 'set', name: undefined },
    });
  });

  it.each([
    null,
    [],
    'card',
    { images: null },
    { images: [null] },
    { variants: null },
    { variants: [null] },
    { variants: [{ prices: null }] },
    { variants: [{ prices: [null] }] },
    { variants: [{ prices: [{ trends: null }] }] },
    { variants: [{ prices: [{ trends: { days_7: null } }] }] },
  ])('rejects malformed structural card data: %j', card => {
    expect(ScrydexRawCardSchema.safeParse(card).success).toBe(false);
  });

  it('retains envelope metadata and both provider total spellings', () => {
    expect(ScrydexSearchResponseSchema.parse({ data: [null], totalCount: 0, total_count: 2, page: 1 })).toEqual({
      data: [null],
      totalCount: 0,
      total_count: 2,
      page: 1,
    });
    expect(ScrydexCardResponseSchema.parse({ data: {}, status: 'success' })).toEqual({ data: {}, status: 'success' });
  });
});
