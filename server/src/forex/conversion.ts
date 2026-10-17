import type { Currency } from './currencies.ts';
import type { ForexSnapshot } from './schemas/responses.ts';

export function decimalMicroUnits(amount: string): bigint {
  const negative = amount.startsWith('-');
  const [whole = '0', fraction = ''] = amount.replace(/^-/, '').split('.');
  const units = BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, '0'));

  return negative ? -units : units;
}

export function convertMicroUnits(
  amount: bigint,
  { source, target, snapshot }: { source: Currency; target: Currency; snapshot?: ForexSnapshot },
): bigint | undefined {
  if (source === target) {
    return amount;
  }

  const sourceRate = snapshot?.rates[source];
  const targetRate = snapshot?.rates[target];

  if (sourceRate == null || targetRate == null || !Number.isFinite(sourceRate) || !Number.isFinite(targetRate)) {
    return undefined;
  }

  const scaledSource = Math.round(sourceRate * 1e12);
  const scaledTarget = Math.round(targetRate * 1e12);

  if (!Number.isFinite(scaledSource) || !Number.isFinite(scaledTarget)) {
    return undefined;
  }

  const sourceUnits = BigInt(scaledSource);
  const targetUnits = BigInt(scaledTarget);

  if (sourceUnits <= 0n || targetUnits <= 0n) {
    return undefined;
  }

  const magnitude = amount < 0n ? -amount : amount;
  const converted = (magnitude * targetUnits + sourceUnits / 2n) / sourceUnits;

  return amount < 0n ? -converted : converted;
}

export function convertMoney(
  amount: string,
  context: { source: Currency; target: Currency; snapshot?: ForexSnapshot },
): string | undefined {
  if (!/^-?\d+(?:\.\d{1,6})?$/.test(amount)) {
    return undefined;
  }

  const units = convertMicroUnits(decimalMicroUnits(amount), context);

  if (units == null) {
    return undefined;
  }

  const magnitude = units < 0n ? -units : units;

  return `${units < 0n ? '-' : ''}${magnitude / 1_000_000n}.${String(magnitude % 1_000_000n).padStart(6, '0')}`;
}
