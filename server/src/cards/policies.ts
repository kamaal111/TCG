import type { UpsertCard, ImportCard } from './schemas/payloads.ts';
import type { OwnedCard, PurchaseBatch } from './types.ts';

export function pricingLinkFields(existing: OwnedCard, values: UpsertCard) {
  const identityChanged =
    existing.game !== values.game || existing.name !== values.name || existing.cardNumber !== values.card_number;

  return {
    pricingCardId: identityChanged ? null : existing.pricingCardId,
    pricingSource: identityChanged ? null : existing.pricingSource,
  };
}

export function decimalScale(amount: string): string {
  const [whole, fraction = ''] = amount.split('.');

  return `${whole}.${fraction.padEnd(6, '0')}`;
}

export function cardFields(values: UpsertCard) {
  return {
    game: values.game,
    name: values.name,
    setName: values.set_name,
    cardNumber: values.card_number,
    notes: values.notes ?? null,
  };
}

export function purchaseBatchFields(cardId: string, batch: UpsertCard['purchases'][number]) {
  return {
    id: batch.id,
    cardId,
    condition: batch.condition,
    quantity: batch.quantity,
    purchasePrice: batch.purchase_price,
    currency: batch.currency,
  };
}

export function importMatches(existing: OwnedCard, purchases: PurchaseBatch[], input: ImportCard): boolean {
  const fields = cardFields(input);

  if (
    existing.game !== fields.game ||
    existing.name !== fields.name ||
    existing.setName !== fields.setName ||
    existing.cardNumber !== fields.cardNumber ||
    existing.notes !== fields.notes ||
    existing.createdAt.getTime() !== new Date(input.created_at).getTime() ||
    existing.updatedAt.getTime() !== new Date(input.updated_at).getTime()
  ) {
    return false;
  }

  const stored = purchases
    .map(purchase =>
      JSON.stringify([
        purchase.condition,
        purchase.quantity,
        purchase.purchasePrice,
        purchase.currency,
        purchase.automaticPriceDate,
      ]),
    )
    .sort();

  const incoming = input.purchases
    .map(purchase =>
      JSON.stringify([
        purchase.condition,
        purchase.quantity,
        purchase.purchase_price != null ? decimalScale(purchase.purchase_price) : null,
        purchase.currency,
        purchase.automatic_price_date,
      ]),
    )
    .sort();

  return stored.length === incoming.length && stored.every((value, index) => value === incoming[index]);
}
