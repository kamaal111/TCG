import type { CardGame, PricingSource, CardPriceRow, CardPriceSearchRow, CardPriceUpsertValues } from './types.ts';
import type { NonEmptyArray } from '../utils/type-utils.ts';

export type { CardPriceRow } from './types.ts';

export interface CardPricingRepository {
  getCachedCardPrice(
    source: PricingSource,
    game: CardGame,
    cardId: string,
    pricedOn: string,
  ): Promise<CardPriceRow | undefined>;
  getCachedCardPriceById(
    source: PricingSource,
    game: CardGame,
    id: string,
    pricedOn: string,
  ): Promise<CardPriceRow | undefined>;
  getCachedCardPrices(source: PricingSource, game: CardGame, ids: string[], pricedOn: string): Promise<CardPriceRow[]>;
  upsertCardPrice(values: CardPriceUpsertValues): Promise<CardPriceRow>;
  upsertCardPrices(values: NonEmptyArray<CardPriceUpsertValues>): Promise<NonEmptyArray<CardPriceRow>>;
  getCachedSearch(
    source: PricingSource,
    game: CardGame,
    query: string,
    pricedOn: string,
  ): Promise<CardPriceSearchRow | undefined>;
  upsertSearch(values: {
    pricingSource: PricingSource;
    game: CardGame;
    queryKey: string;
    pricedOn: string;
    pricingCardIds: string[];
  }): Promise<void>;
  setOwnedCardPricingIdentity(id: string, pricingCardId: string, source: PricingSource): Promise<void>;
}
