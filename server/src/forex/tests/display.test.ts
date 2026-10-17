import type { PricedCardResponse } from '../../card-pricing/schemas/responses.ts';
import { convertMoney } from '../conversion.ts';
import { displayPricedCard, displayPurchase } from '../display.ts';

const snapshot = { base: 'EUR', date: '2026-10-16', rates: { EUR: 1, USD: 1.25, JPY: 150 } } as const;

test.each([
  ['12.500000', 'USD', 'EUR', '10.000000'],
  ['-2.500000', 'USD', 'EUR', '-2.000000'],
  ['1500.000000', 'JPY', 'EUR', '10.000000'],
  ['0.000001', 'EUR', 'USD', '0.000001'],
] as const)('converts %s %s to %s using six decimal fixed-point amounts', (amount, source, target, expected) => {
  expect(convertMoney(amount, { source, target, snapshot })).toBe(expected);
});

test('same-currency amounts do not require an exchange-rate snapshot', () => {
  expect(displayPurchase('12.500000', 'USD', { currency: 'USD' })).toEqual({
    amount: '12.500000',
    currency: 'USD',
    conversion_unavailable: false,
  });
});

test('missing rates retain the source amount and identify an unavailable conversion', () => {
  expect(displayPurchase('1500.000000', 'JPY', { currency: 'EUR' })).toEqual({
    amount: '1500.000000',
    currency: 'JPY',
    conversion_unavailable: true,
  });
});

test('display pricing converts monetary movements while preserving source prices and percentages', () => {
  const card: PricedCardResponse = {
    id: '550e8400-e29b-41d4-a716-446655440000',
    game: 'pokemon',
    name: 'Pikachu',
    card_number: '58',
    priced_on: '2026-10-16T00:00:00.000Z',
    fetched_at: '2026-10-16T10:00:00.000Z',
    headline: { amount: 12.5, currency: 'USD', metric: 'lowest_near_mint' },
    market: {
      condition: 'near_mint',
      currency: 'USD',
      low: 12.5,
      market: 25,
      trend_7d: { price_change: -2.5, percent_change: -10 },
      trend_30d: { price_change: 5, percent_change: 20 },
    },
  };

  const result = displayPricedCard(card, { currency: 'EUR', snapshot });

  expect(result.market).toEqual(card.market);
  expect(result.headline).toEqual(card.headline);
  expect(card.display).toBeUndefined();
  expect(result.display).toEqual({
    preferred_currency: 'EUR',
    conversion_unavailable: false,
    headline: { amount: 10, currency: 'EUR', metric: 'lowest_near_mint' },
    market: {
      condition: 'near_mint',
      currency: 'EUR',
      low: 10,
      market: 20,
      trend_7d: { price_change: -2, percent_change: -10 },
      trend_30d: { price_change: 4, percent_change: 20 },
    },
  });
});
