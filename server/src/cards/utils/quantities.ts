import type { ConditionQuantity } from '../types.ts';

export function purchaseQuantities(purchases: readonly ConditionQuantity[]): ConditionQuantity[] {
  return purchases
    .reduce(
      (totals, purchase) => totals.set(purchase.condition, (totals.get(purchase.condition) ?? 0) + purchase.quantity),
      new Map<ConditionQuantity['condition'], number>(),
    )
    .entries()
    .toArray()
    .map(([condition, quantity]) => ({ condition, quantity }));
}
