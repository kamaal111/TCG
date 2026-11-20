import type { CardListPageInfo } from './list-page.ts';
import type { Currency } from '../forex/currencies.ts';

export const CARD_GAMES = ['one_piece', 'pokemon'] as const;

export const CARD_CONDITION_MAP = {
  MINT: 'mint',
  NEAR_MINT: 'near_mint',
  EXCELLENT: 'excellent',
  GOOD: 'good',
  PLAYED: 'played',
  DAMAGED: 'damaged',
} as const;

export const CARD_CONDITIONS = [
  CARD_CONDITION_MAP.MINT,
  CARD_CONDITION_MAP.NEAR_MINT,
  CARD_CONDITION_MAP.EXCELLENT,
  CARD_CONDITION_MAP.GOOD,
  CARD_CONDITION_MAP.PLAYED,
  CARD_CONDITION_MAP.DAMAGED,
] as const;

export const MAX_COPIES_PER_CONDITION = 999;

export type CardCondition = (typeof CARD_CONDITIONS)[number];

export type CardGame = (typeof CARD_GAMES)[number];

export interface OwnedCard {
  id: string;
  importSourceId: string | null;
  collectionId?: string | null;
  allocationAdjustments?: number;
  userId: string;
  game: CardGame;
  name: string;
  setName: string;
  cardNumber: string;
  pricingCardId: string | null;
  pricingSource: string | null;
  illustrator?: string | null;
  englishSearchAlias?: string | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export type CardIdentity = Pick<OwnedCard, 'game' | 'name' | 'setName' | 'cardNumber'>;

export type CatalogPrinting = CardIdentity &
  Pick<OwnedCard, 'illustrator'> & {
    pricingCardId: string;
    pricingSource: string;
  };

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

export interface CardCollection extends CardListPageInfo {
  cards: CardWithPurchases[];
}
