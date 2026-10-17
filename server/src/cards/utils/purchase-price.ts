import type { PricedCardResponse } from '../../card-pricing/schemas/responses.ts';
import type { cardPurchaseBatch } from '../../db/schema/cards.ts';
import { convertMicroUnits, decimalMicroUnits } from '../../forex/conversion.ts';
import type { ForexSnapshot } from '../../forex/schemas/responses.ts';

type BatchCost = Pick<typeof cardPurchaseBatch.$inferSelect, 'quantity' | 'purchasePrice' | 'currency'>;

type Market = Pick<NonNullable<PricedCardResponse['market']>, 'market' | 'currency'>;

// Six decimal places match persisted purchase amounts and avoid fractional cost drift.
export function marketPurchaseAmount(amount: number): string | null {
  if (!Number.isFinite(amount) || amount < 0 || amount >= 1e14) {
    return null;
  }

  return amount.toFixed(6);
}

export function purchasePriceChangePercent(
  batches: readonly BatchCost[],
  market: Market | undefined,
  snapshot?: ForexSnapshot,
): number | null {
  if (market?.market == null || batches.length === 0) {
    return null;
  }

  let cost = 0n;
  let quantity = 0n;

  for (const batch of batches) {
    if (batch.purchasePrice == null || batch.currency == null) {
      return null;
    }

    const amount = convertMicroUnits(decimalMicroUnits(batch.purchasePrice), {
      source: batch.currency,
      target: market.currency,
      snapshot,
    });

    if (amount == null) {
      return null;
    }

    cost += amount * BigInt(batch.quantity);
    quantity += BigInt(batch.quantity);
  }

  if (cost === 0n) {
    return null;
  }

  const amount = marketPurchaseAmount(market.market);

  if (amount == null) {
    return null;
  }

  const current = decimalMicroUnits(amount) * quantity;

  return Number(((current - cost) * 100_000_000n) / cost) / 1_000_000;
}
