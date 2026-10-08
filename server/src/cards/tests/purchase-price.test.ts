import { purchasePriceChangePercent } from '../utils/purchase-price.ts';

const batches = [
  { quantity: 2, purchasePrice: '2', currency: 'USD' },
  { quantity: 3, purchasePrice: '4', currency: 'USD' },
];

describe('Purchase price comparison', () => {
  test.each([
    [4, 25],
    [2.4, -25],
    [3.2, 0],
  ])('compares weighted cost with market %s', (market, expected) => {
    expect(purchasePriceChangePercent(batches, { market, currency: 'USD' })).toBe(expected);
  });

  test('does not compare partially unknown costs', () => {
    expect(
      purchasePriceChangePercent([...batches, { quantity: 1, purchasePrice: null, currency: null }], {
        market: 4,
        currency: 'USD',
      }),
    ).toBeNull();
  });

  test('does not compare different currencies', () => {
    expect(purchasePriceChangePercent(batches, { market: 4, currency: 'JPY' })).toBeNull();
  });

  test('does not divide by zero cost', () => {
    expect(
      purchasePriceChangePercent([{ quantity: 5, purchasePrice: '0', currency: 'USD' }], {
        market: 4,
        currency: 'USD',
      }),
    ).toBeNull();
  });

  test('does not fall back to the lowest price', () => {
    expect(purchasePriceChangePercent(batches, { currency: 'USD' })).toBeNull();
  });

  test('keeps fractional costs exact', () => {
    expect(
      purchasePriceChangePercent([{ quantity: 3, purchasePrice: '0.100001', currency: 'USD' }], {
        market: 0.100001,
        currency: 'USD',
      }),
    ).toBe(0);
  });
});
