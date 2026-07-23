import type { CARD_GAMES } from '../../db/schema/cards.ts';

export type CardGame = (typeof CARD_GAMES)[number];

export interface TCGGORawPriceBlock {
  currency?: unknown;
  lowest_near_mint?: unknown;
  ['7d_average']?: unknown;
  ['30d_average']?: unknown;
  market_price?: unknown;
  mid_price?: unknown;
  graded?: unknown;
  [key: string]: unknown;
}

export interface TCGGORawCard {
  id?: unknown;
  name?: unknown;
  card_number?: unknown;
  rarity?: unknown;
  image?: unknown;
  prices?: {
    cardmarket?: TCGGORawPriceBlock;
    tcg_player?: TCGGORawPriceBlock;
    tcgplayer?: TCGGORawPriceBlock;
    ebay?: unknown;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface NormalizedPricing {
  cardmarket?: {
    currency: string;
    lowestNearMint?: number;
    average7d?: number;
    average30d?: number;
    graded?: unknown;
  };
  tcgplayer?: {
    currency: string;
    marketPrice?: number;
    midPrice?: number;
  };
  ebay?: unknown;
  image?: string;
  rarity?: string;
}

export interface NormalizedTCGGOCard {
  id: string;
  name: string;
  cardNumber: string;
  pricing: NormalizedPricing;
}
