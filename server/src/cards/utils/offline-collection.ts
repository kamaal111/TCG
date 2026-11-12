import { sha256Hex } from '@tcg/crypto/sha256';
import type { z } from 'zod';

import { serializeCardWithPrice } from './cards.ts';
import { OWNED_CARD_PRICE_STATUSES } from '../../card-pricing/schemas/responses.ts';
import { serializePricedCard } from '../../card-pricing/utils/pricing.ts';
import type { Collection } from '../../collections/schemas/responses.ts';
import type { HonoContext } from '../../context.ts';
import type { OfflineCollectionIDs } from '../offline-collection-repository.ts';
import type { ManifestSchema } from '../schemas/offline-collection.ts';
import type { CardWithPriceResponse } from '../schemas/responses.ts';

export function hashOfflineRecord(value: CardWithPriceResponse | Collection | z.infer<typeof ManifestSchema>) {
  return sha256Hex(JSON.stringify(value));
}

export async function readOfflineRecords(c: HonoContext, ids: OfflineCollectionIDs | undefined) {
  const snapshot = await c.get('offlineCollectionRepository').read(ids);

  const cards = snapshot.cards.map(({ owned, price }) => {
    const cached = price != null ? serializePricedCard(owned.game, price, c.get('config').PUBLIC_BASE_URL) : undefined;

    if (cached == null) {
      return serializeCardWithPrice(owned, { card_id: owned.id, status: OWNED_CARD_PRICE_STATUSES.UNAVAILABLE });
    }

    const status = cached.market != null ? OWNED_CARD_PRICE_STATUSES.PRICED : OWNED_CARD_PRICE_STATUSES.NO_PRICE;

    return serializeCardWithPrice(owned, { card_id: owned.id, status, priced_card: cached });
  });

  return { cards, collections: snapshot.collections };
}

export function offlineEntriesFor(records: Awaited<ReturnType<typeof readOfflineRecords>>) {
  return [
    ...records.cards.map(card => ({ kind: 'card' as const, id: card.id, hash: hashOfflineRecord(card) })),
    ...records.collections.map(collection => ({
      kind: 'collection' as const,
      id: collection.id,
      hash: hashOfflineRecord(collection),
    })),
  ].sort((left, right) => left.kind.localeCompare(right.kind) || left.id.localeCompare(right.id));
}
