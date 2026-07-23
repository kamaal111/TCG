import type { CARD_GAMES } from '../db/schema/cards.ts';
import type { GetRecordValues } from '../utils/type-utils.ts';

export type CardGame = (typeof CARD_GAMES)[number];

export const CARD_GAME_MAP: { [K in (typeof CARD_GAMES)[number] as Uppercase<K>]: K } = {
  ONE_PIECE: 'one_piece',
  POKEMON: 'pokemon',
};

export const CURRENCIES = {
  JPY: 'JPY',
  USD: 'USD',
} as const;

export type Currency = GetRecordValues<typeof CURRENCIES>;

export const PRICING_SOURCES = {
  SCRYDEX_REAL: 'scrydex_real',
  SCRYDEX_STATIC: 'scrydex_static',
  TCGGO_LEGACY: 'tcggo_legacy',
  TCGGO_REAL: 'tcggo_real',
  TCGGO_STATIC: 'tcggo_static',
} as const;

export type PricingSource = GetRecordValues<typeof PRICING_SOURCES>;

export interface PriceMovement {
  priceChange: number;
  percentChange: number;
}

export interface NormalizedPricing {
  market?: {
    condition: 'near_mint';
    currency: Currency;
    low?: number;
    market?: number;
    trend7d?: PriceMovement;
    trend30d?: PriceMovement;
  };
  image?: string;
  rarity?: string;
}

export interface NormalizedPricingCard {
  id: string;
  name: string;
  cardNumber: string;
  pricing: NormalizedPricing;
}

export interface PricingCardRecord {
  card: NormalizedPricingCard;
  raw: unknown;
}
