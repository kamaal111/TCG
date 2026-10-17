import type { PricedCardResponse } from '../../card-pricing/schemas/responses.ts';
import type { cardPurchaseBatch } from '../../db/schema/cards.ts';
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

function microUnits(amount: string): bigint {
  const [whole = '0', fraction = ''] = amount.split('.');

  return BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, '0'));
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

    let amount = microUnits(batch.purchasePrice);

    if (batch.currency !== market.currency) {
      const source = snapshot?.rates[batch.currency];
      const target = snapshot?.rates[market.currency];

      if (
        source == null ||
        target == null ||
        source <= 0 ||
        target <= 0 ||
        !Number.isFinite(source) ||
        !Number.isFinite(target)
      ) {
        return null;
      }

      const sourceUnits = BigInt(Math.round(source * 1e12));
      const targetUnits = BigInt(Math.round(target * 1e12));

      if (sourceUnits === 0n || targetUnits === 0n) {
        return null;
      }

      amount = (amount * targetUnits + sourceUnits / 2n) / sourceUnits;
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

  const current = microUnits(amount) * quantity;

  return Number(((current - cost) * 100_000_000n) / cost) / 1_000_000;
}
