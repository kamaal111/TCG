import type { CardLanguage } from './languages.ts';
import { CARD_CONDITION_MAP, type CARD_GAMES, type CardCondition } from '../cards/types.ts';
import type { Currency } from '../forex/currencies.ts';
import type { GetRecordValues } from '../utils/type-utils.ts';

export type CardGame = (typeof CARD_GAMES)[number];

export const CARD_GAME_MAP = {
  ONE_PIECE: 'one_piece',
  POKEMON: 'pokemon',
} satisfies { [K in (typeof CARD_GAMES)[number] as Uppercase<K>]: K };

export type { Currency } from '../forex/currencies.ts';

export const PRICING_SOURCES = {
  SCRYDEX_REAL: 'scrydex_real',
  SCRYDEX_STATIC: 'scrydex_static',
  TCGGO_LEGACY: 'tcggo_legacy',
  TCGGO_REAL: 'tcggo_real',
  TCGGO_STATIC: 'tcggo_static',
} as const;

export type PricingSource = GetRecordValues<typeof PRICING_SOURCES>;

export const SCRYDEX_PRICING_SOURCES = [PRICING_SOURCES.SCRYDEX_REAL, PRICING_SOURCES.SCRYDEX_STATIC] as const;

export function isScrydexPricingSource(source: string | null): source is (typeof SCRYDEX_PRICING_SOURCES)[number] {
  return SCRYDEX_PRICING_SOURCES.some(scrydexSource => scrydexSource === source);
}

export interface PriceMovement {
  priceChange: number;
  percentChange: number;
}

export type PricingSearchMode = 'card' | 'illustrator';

export interface PricingSearchOptions {
  languages: readonly CardLanguage[];
  searchBy: PricingSearchMode;
}

export const QUOTED_CONDITIONS = [
  CARD_CONDITION_MAP.NEAR_MINT,
  CARD_CONDITION_MAP.EXCELLENT,
  CARD_CONDITION_MAP.GOOD,
  CARD_CONDITION_MAP.PLAYED,
  CARD_CONDITION_MAP.DAMAGED,
] as const satisfies readonly CardCondition[];

export const CONDITION_VALUE_BASIS_MAP = {
  MARKET: 'market',
  LOW: 'low',
  INTERPOLATED: 'interpolated',
  ADJUSTED: 'adjusted',
} as const;

export interface NormalizedConditionPrice {
  condition: (typeof QUOTED_CONDITIONS)[number];
  currency: Currency;
  low?: number;
  market?: number;
  trend7d?: PriceMovement;
  trend30d?: PriceMovement;
}

export interface NormalizedPricing {
  illustrator?: string;
  variantName?: string;
  setName?: string;
  market?: NormalizedConditionPrice & { condition: typeof CARD_CONDITION_MAP.NEAR_MINT };
  conditionPrices?: NormalizedConditionPrice[];
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

export interface CardPriceRow {
  id: string;
  game: CardGame;
  pricingCardId: string;
  cardNumber: string;
  name: string;
  pricedOn: string;
  prices: NormalizedPricing;
  raw: unknown;
  pricingSource: PricingSource;
  fetchedAt: Date;
}

export interface CardPriceSearchRow {
  id: string;
  game: CardGame;
  queryKey: string;
  pricedOn: string;
  pricingCardIds: string[];
  hasMore: boolean;
  pricingSource: PricingSource;
  fetchedAt: Date;
}

export interface CardPriceUpsertValues {
  game: CardGame;
  card: NormalizedPricingCard;
  raw: unknown;
  pricedOn: string;
  pricingSource: PricingSource;
}
