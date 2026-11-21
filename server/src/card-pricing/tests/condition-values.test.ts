import { CARD_CONDITION_MAP } from '../../cards/types.ts';
import { resolveConditionValues } from '../utils/conditions.ts';

test('uses matched averages, zero lows and neighboring quotes for missing bands', () => {
  const values = resolveConditionValues([
    { condition: 'excellent', currency: 'USD', low: 17, market: 20 },
    { condition: 'played', currency: 'USD', market: 12 },
    { condition: 'damaged', currency: 'USD', low: 0 },
  ]);

  expect(values).toMatchObject([
    { condition: 'mint', basis: 'adjusted' },
    { condition: 'near_mint', basis: 'adjusted' },
    { condition: 'excellent', amount: 20, basis: 'market' },
    { condition: 'good', amount: 16, basis: 'interpolated' },
    { condition: 'played', amount: 12, basis: 'market' },
    { condition: 'damaged', amount: 0, basis: 'low' },
  ]);
  expect(values[0]?.amount).toBeCloseTo(24.69, 2);
  expect(values[1]?.amount).toBeCloseTo(20 / 0.9, 6);
});

test('adjusts from the better quote on equally distant anchors with different currencies', () => {
  const values = resolveConditionValues([
    { condition: 'excellent', currency: 'USD', market: 20 },
    { condition: 'played', currency: 'JPY', market: 1_000 },
  ]);

  expect(values.find(value => value.condition === CARD_CONDITION_MAP.GOOD)).toEqual({
    condition: 'good',
    amount: 18,
    currency: 'USD',
    basis: 'adjusted',
  });
});

test('returns no unit values when quotes contain only movements', () => {
  expect(
    resolveConditionValues([
      { condition: 'near_mint', currency: 'USD', trend_7d: { price_change: 1, percent_change: 10 } },
    ]),
  ).toEqual([]);
});

test('estimates Mint one condition step above a single Near Mint quote', () => {
  const values = resolveConditionValues([{ condition: 'near_mint', currency: 'USD', market: 20 }]);

  expect(values.map(({ condition, amount, basis }) => [condition, Number(amount.toFixed(2)), basis])).toEqual([
    ['mint', 22.22, 'adjusted'],
    ['near_mint', 20, 'market'],
    ['excellent', 18, 'adjusted'],
    ['good', 16.2, 'adjusted'],
    ['played', 14.58, 'adjusted'],
    ['damaged', 13.12, 'adjusted'],
  ]);
});

test('estimates Mint from an estimated Near Mint value in the same currency', () => {
  const values = resolveConditionValues([{ condition: 'excellent', currency: 'EUR', market: 18 }]);

  expect(
    values
      .slice(0, 2)
      .map(({ condition, amount, currency, basis }) => [condition, Number(amount.toFixed(2)), currency, basis]),
  ).toEqual([
    ['mint', 22.22, 'EUR', 'adjusted'],
    ['near_mint', 20, 'EUR', 'adjusted'],
  ]);
});

test('keeps a zero Near Mint quote without estimating a Mint premium from it', () => {
  expect(resolveConditionValues([{ condition: 'near_mint', currency: 'USD', low: 0 }])).toEqual([
    { condition: 'near_mint', amount: 0, currency: 'USD', basis: 'low' },
  ]);
});

test.each([12, 20])('uses the better quote of $%s when the $20 worse quote cannot bracket Good', excellent => {
  const values = resolveConditionValues([
    { condition: 'excellent', currency: 'USD', market: excellent },
    { condition: 'played', currency: 'USD', market: 20 },
  ]);

  expect(values).toContainEqual({ condition: 'good', amount: excellent * 0.9, currency: 'USD', basis: 'adjusted' });
  expect(values).toContainEqual({ condition: 'played', amount: 20, currency: 'USD', basis: 'market' });
});

test('interpolates a sub-cent estimate strictly between its two quotes', () => {
  const values = resolveConditionValues([
    { condition: 'excellent', currency: 'USD', market: 0.02 },
    { condition: 'played', currency: 'USD', market: 0.01 },
  ]);

  const good = values.find(value => value.condition === CARD_CONDITION_MAP.GOOD);
  expect(good?.basis).toBe('interpolated');
  expect(good?.amount).toBeCloseTo(0.015, 8);
  expect(good?.amount).toBeLessThan(0.02);
  expect(good?.amount).toBeGreaterThan(0.01);
});

test('keeps an actual zero quote without deriving equal prices from it', () => {
  expect(resolveConditionValues([{ condition: 'good', currency: 'USD', low: 0 }])).toEqual([
    { condition: 'good', amount: 0, currency: 'USD', basis: 'low' },
  ]);
});
