import type { ResolvedCSVCard } from './repository.ts';
import type { UpdateCard, ImportCard } from './schemas/payloads.ts';
import type { CardIdentity, OwnedCard, PurchaseBatch } from './types.ts';

export function sameCardIdentity(left: CardIdentity, right: CardIdentity): boolean {
  return (
    left.game === right.game &&
    left.name === right.name &&
    left.setName === right.setName &&
    left.cardNumber === right.cardNumber
  );
}

export function pricingLinkFields(existing: OwnedCard, values: CardIdentity) {
  const identityChanged = !sameCardIdentity(existing, values);

  return {
    pricingCardId: identityChanged ? null : existing.pricingCardId,
    pricingSource: identityChanged ? null : existing.pricingSource,
  };
}

export function decimalScale(amount: string): string {
  const [whole, fraction = ''] = amount.split('.');

  return `${whole}.${fraction.padEnd(6, '0')}`;
}

export function cardFields(values: ImportCard | ResolvedCSVCard) {
  if ('printing' in values) {
    const { illustrator: _illustrator, ...identity } = values.printing;

    return { ...identity, notes: values.notes ?? null };
  }

  return {
    game: values.game,
    name: values.name,
    setName: values.set_name,
    cardNumber: values.card_number,
    notes: values.notes ?? null,
  };
}

export function purchaseBatchFields(cardId: string, batch: UpdateCard['purchases'][number]) {
  return {
    id: batch.id,
    cardId,
    condition: batch.condition,
    quantity: batch.quantity,
    purchasePrice: batch.purchase_price,
    currency: batch.currency,
    automaticPriceDate: batch.automatic_price_date ?? null,
  };
}

export function importMatches(
  existing: OwnedCard,
  purchases: PurchaseBatch[],
  input: ImportCard | ResolvedCSVCard,
): boolean {
  const fields = cardFields(input);

  if (
    !sameCardIdentity(existing, fields) ||
    existing.notes !== fields.notes ||
    (!('printing' in input) && existing.createdAt.getTime() !== new Date(input.created_at).getTime()) ||
    existing.updatedAt.getTime() !== new Date(input.updated_at).getTime()
  ) {
    return false;
  }

  const stored = purchases
    .map(purchase => {
      return JSON.stringify([
        purchase.condition,
        purchase.quantity,
        purchase.purchasePrice,
        purchase.currency,
        purchase.automaticPriceDate,
      ]);
    })
    .sort();

  const incoming = input.purchases
    .map(purchase => {
      return JSON.stringify([
        purchase.condition,
        purchase.quantity,
        purchase.purchase_price != null ? decimalScale(purchase.purchase_price) : null,
        purchase.currency,
        purchase.automatic_price_date,
      ]);
    })
    .sort();

  return stored.length === incoming.length && stored.every((value, index) => value === incoming[index]);
}
