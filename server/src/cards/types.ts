import type { Currency } from '../forex/currencies.ts';

export const CARD_GAMES = ['one_piece', 'pokemon'] as const;

export const CARD_CONDITIONS = ['mint', 'near_mint', 'excellent', 'good', 'played', 'damaged'] as const;

export const MAX_COPIES_PER_CONDITION = 999;

export type CardCondition = (typeof CARD_CONDITIONS)[number];

export type CardGame = (typeof CARD_GAMES)[number];

export interface OwnedCard {
  id: string;
  importSourceId: string | null;
  userId: string;
  game: CardGame;
  name: string;
  setName: string;
  cardNumber: string;
  pricingCardId: string | null;
  pricingSource: string | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface PurchaseBatch {
  id: string;
  cardId: string;
  condition: CardCondition;
  quantity: number;
  purchasePrice: string | null;
  currency: Currency | null;
  automaticPriceDate: string | null;
}

export interface ConditionQuantity {
  condition: CardCondition;
  quantity: number;
}

export type CardWithPurchases = OwnedCard & { purchaseBatches: PurchaseBatch[] };

export interface CardCollection {
  cards: CardWithPurchases[];
  availableSetNames: string[];
  nextCursor: string | null;
}
