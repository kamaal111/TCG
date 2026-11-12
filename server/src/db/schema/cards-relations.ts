import { defineRelationsPart } from 'drizzle-orm';

import { user } from './better-auth.ts';
import { cardPrice } from './card-pricing.ts';
import {
  binderPage,
  binderSlot,
  card,
  cardCollection,
  cardConditionQuantity,
  cardMetadata,
  cardPurchaseBatch,
} from './cards.ts';

export const cardsRelations = defineRelationsPart(
  {
    user,
    card,
    cardMetadata,
    cardConditionQuantity,
    cardPurchaseBatch,
    cardPrice,
    cardCollection,
    binderPage,
    binderSlot,
  },
  r => ({
    card: {
      cachedPrices: r.many.cardPrice({
        from: [r.card.pricingSource, r.card.game, r.card.pricingCardId],
        to: [r.cardPrice.pricingSource, r.cardPrice.game, r.cardPrice.pricingCardId],
      }),
      metadata: r.one.cardMetadata({
        from: [r.card.pricingSource, r.card.game, r.card.pricingCardId],
        to: [r.cardMetadata.pricingSource, r.cardMetadata.game, r.cardMetadata.pricingCardId],
      }),
      user: r.one.user({ from: r.card.userId, to: r.user.id }),
      purchaseBatches: r.many.cardPurchaseBatch({ from: r.card.id, to: r.cardPurchaseBatch.cardId }),
      quantities: r.many.cardConditionQuantity({
        from: r.card.id,
        to: r.cardConditionQuantity.cardId,
      }),
    },
    cardCollection: {
      pages: r.many.binderPage({ from: r.cardCollection.id, to: r.binderPage.collectionId }),
    },
    binderPage: {
      slots: r.many.binderSlot({ from: r.binderPage.id, to: r.binderSlot.pageId }),
    },
    binderSlot: {
      card: r.one.card({ from: r.binderSlot.cardId, to: r.card.id }),
    },
    cardMetadata: {},
    cardPurchaseBatch: {
      card: r.one.card({ from: r.cardPurchaseBatch.cardId, to: r.card.id }),
    },
    cardConditionQuantity: {
      card: r.one.card({ from: r.cardConditionQuantity.cardId, to: r.card.id }),
    },
  }),
);
