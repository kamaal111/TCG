import { purchasePriceChangePercent } from './purchase-price.ts';
import { proxyURLForOriginURL } from '../../card-images/keys.ts';
import type { OwnedCardPriceResponse } from '../../card-pricing/schemas/responses.ts';
import type { HonoContext } from '../../context.ts';
import { displayPricedCard, displayPurchase, type ForexDisplayContext } from '../../forex/display.ts';
import { toISO8601String } from '../../utils/strings.ts';
import type { CardWithPurchases } from '../repository.ts';
import type { CardResponse, CardWithPriceResponse, OwnedCardPriceUpdate } from '../schemas/responses.ts';
import type { PurchaseBatch } from '../types.ts';

export function serializeCard(card: CardWithPurchases): CardResponse {
  return serializeCardFields(card);
}

export async function serializeOwnedCardDetails(c: HonoContext, cards: CardWithPurchases[]) {
  if (cards.length === 0) {
    return [];
  }

  const [cached, display] = await Promise.all([
    c.get('cardRepository').getArtworkOrigins(cards.map(card => card.id)),
    c.get('forexService').displayContext(),
  ]);

  const baseURL = c.get('config').PUBLIC_BASE_URL;

  const artwork = new Map(
    cached.map(({ id, origin }) => [id, origin != null ? proxyURLForOriginURL(origin, baseURL) : undefined]),
  );

  return cards.map(card => ({
    ...serializeCardFields(card, display.isOk() ? display.value : undefined),
    artwork_url: artwork.get(card.id),
  }));
}

export function serializeCardWithPrice(
  card: CardWithPurchases,
  price: OwnedCardPriceResponse,
  display?: ForexDisplayContext,
): CardWithPriceResponse {
  const fields = serializeCardFields(card, display);

  return { ...fields, ...serializePriceFields(card, price, display) };
}

export function serializeOwnedPriceUpdate(
  card: CardWithPurchases,
  price: OwnedCardPriceResponse,
  display: ForexDisplayContext,
): OwnedCardPriceUpdate {
  return {
    id: card.id,
    updated_at: toISO8601String(card.updatedAt),
    display_currency: display.currency,
    purchases: card.purchaseBatches.map(batch => serializePurchase(batch, display)),
    ...serializePriceFields(card, price, display),
  };
}

function serializePriceFields(card: CardWithPurchases, price: OwnedCardPriceResponse, display?: ForexDisplayContext) {
  return {
    illustrator: price.priced_card?.illustrator ?? card.illustrator ?? undefined,
    purchase_price_change_percent: purchasePriceChangePercent(
      card.purchaseBatches,
      price.priced_card?.market,
      display?.snapshot,
    ),
    price:
      display != null && price.priced_card != null
        ? { ...price, priced_card: displayPricedCard(price.priced_card, display) }
        : price,
  };
}

function serializeCardFields(card: CardWithPurchases, display?: ForexDisplayContext): CardResponse {
  return {
    id: card.id,
    collection_id: card.collectionId,
    allocation_adjustments: card.allocationAdjustments,
    game: card.game,
    name: card.name,
    set_name: card.setName,
    card_number: card.cardNumber,
    notes: card.notes,
    illustrator: card.illustrator ?? undefined,
    purchases: card.purchaseBatches.map(batch => serializePurchase(batch, display)),
    purchase_price_change_percent: null,
    display_currency: display?.currency,
    created_at: toISO8601String(card.createdAt),
    updated_at: toISO8601String(card.updatedAt),
  };
}

export function serializePurchase(
  batch: PurchaseBatch,
  display?: ForexDisplayContext,
): CardResponse['purchases'][number] {
  return {
    id: batch.id,
    condition: batch.condition,
    quantity: batch.quantity,
    purchase_price: batch.purchasePrice,
    currency: batch.currency,
    automatic_price_date: batch.automaticPriceDate,
    display_price:
      display != null && batch.purchasePrice != null && batch.currency != null
        ? displayPurchase(batch.purchasePrice, batch.currency, display)
        : undefined,
  };
}
