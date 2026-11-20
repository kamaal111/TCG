import type {
  ConditionValueResponse,
  OwnedValuationResponse,
  PricedCardResponse,
} from '../../card-pricing/schemas/responses.ts';
import { CONDITION_VALUE_BASIS_MAP } from '../../card-pricing/types.ts';
import { conditionValue } from '../../card-pricing/utils/conditions.ts';
import { convertMicroUnits, decimalMicroUnits } from '../../forex/conversion.ts';
import type { Currency } from '../../forex/currencies.ts';
import type { ForexDisplayContext } from '../../forex/display.ts';
import type { ForexSnapshot } from '../../forex/schemas/responses.ts';
import { CARD_CONDITION_MAP, type PurchaseBatch } from '../types.ts';

type BatchCost = Pick<PurchaseBatch, 'quantity' | 'purchasePrice' | 'currency'>;

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

  const amount = marketPurchaseAmount(market.market);

  if (amount == null) {
    return null;
  }

  const quantity = batches.reduce((total, batch) => total + BigInt(batch.quantity), 0n);

  return comparePurchaseCost(batches, decimalMicroUnits(amount) * quantity, market.currency, snapshot);
}

function comparePurchaseCost(
  batches: readonly BatchCost[],
  current: bigint,
  currency: Currency,
  snapshot: ForexSnapshot | undefined,
) {
  let cost = 0n;

  for (const batch of batches) {
    if (batch.purchasePrice == null || batch.currency == null) {
      return null;
    }

    const amount = convertMicroUnits(decimalMicroUnits(batch.purchasePrice), {
      source: batch.currency,
      target: currency,
      snapshot,
    });

    if (amount == null) {
      return null;
    }

    cost += amount * BigInt(batch.quantity);
  }

  if (cost === 0n) {
    return null;
  }

  return Number(((current - cost) * 100_000_000n) / cost) / 1_000_000;
}

export function ownedValuation(
  batches: readonly PurchaseBatch[],
  values: readonly ConditionValueResponse[] | undefined,
  display: ForexDisplayContext | undefined,
): OwnedValuationResponse | undefined {
  const lines: { value: ConditionValueResponse; amount: bigint; quantity: bigint }[] = [];

  for (const batch of batches) {
    const value = conditionValue(values, batch.condition);
    const amount = value != null ? marketPurchaseAmount(value.amount) : null;

    if (value == null || amount == null) {
      return undefined;
    }

    lines.push({ value, amount: decimalMicroUnits(amount), quantity: BigInt(batch.quantity) });
  }

  const source = lines[0]?.value.currency;

  if (source == null) {
    return undefined;
  }

  function totalIn(currency: Currency) {
    let total = 0n;

    for (const { value, amount, quantity } of lines) {
      const converted = convertMicroUnits(amount, {
        source: value.currency,
        target: currency,
        snapshot: display?.snapshot,
      });

      if (converted == null) {
        return undefined;
      }

      total += converted * quantity;
    }

    return total;
  }

  const preferred = display?.currency ?? source;
  const preferredTotal = totalIn(preferred);
  const currency = preferredTotal == null ? source : preferred;
  const total = preferredTotal ?? (lines.every(line => line.value.currency === source) ? totalIn(source) : undefined);

  if (total == null) {
    return undefined;
  }

  return {
    amount: Number(total) / 1_000_000,
    currency,
    estimated: lines.some(
      ({ value }) => value.basis !== CONDITION_VALUE_BASIS_MAP.MARKET || value.condition === CARD_CONDITION_MAP.MINT,
    ),
    conversion_unavailable: preferredTotal == null,
    purchase_price_change_percent: comparePurchaseCost(batches, total, currency, display?.snapshot) ?? undefined,
  };
}
