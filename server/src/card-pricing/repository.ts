import type { CardGame, PricingSource, CardPriceRow, CardPriceSearchRow, CardPriceUpsertValues } from './types.ts';
import type { OwnedCard } from '../cards/types.ts';
import type { NonEmptyArray } from '../utils/type-utils.ts';

export type { CardPriceRow } from './types.ts';

export interface CardPricingRepository {
  getCachedCardPrice(
    source: PricingSource,
    game: CardGame,
    cardId: string,
    pricedOn: string,
  ): Promise<CardPriceRow | undefined>;
  getCachedCardPriceById(source: PricingSource, game: CardGame, id: string): Promise<CardPriceRow | undefined>;
  findCachedPrinting(
    source: PricingSource,
    game: CardGame,
    printing: { name: string; setName: string; cardNumber: string },
  ): Promise<string | undefined>;
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
    hasMore: boolean;
  }): Promise<void>;
  setOwnedCardPricingIdentity(owned: OwnedCard, pricingCardId: string, source: PricingSource): Promise<void>;
}
