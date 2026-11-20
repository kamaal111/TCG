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
