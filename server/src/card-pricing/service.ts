import type { CardWithQuantities } from '../cards/repository.ts';
import { CardRepository } from '../cards/repository.ts';
import type { HonoContext } from '../context.ts';
import { withRequestLogger } from '../logging/http.ts';
import { logInfo } from '../logging/index.ts';
import { CardPricingRepository, type PricingDatabase } from './repository.ts';
import type { OwnedCardPriceResponse, PricedCardResponse } from './schemas/responses.ts';
import { normalizeTCGGOCard } from './tcggo/normalize.ts';
import type { CardGame } from './tcggo/types.ts';
import { buildSearchQuery, normalizeCardNumber, normalizeName, queryKey, todayUTC } from './utils/query.ts';
import { serializePricedCard } from './utils/pricing.ts';

export class CardPricingService {
  static async searchAndPrice(
    c: HonoContext,
    game: CardGame,
    query: string,
  ): Promise<{ normalizedQuery: string; matches: PricedCardResponse[] }> {
    const normalizedQuery = normalizeName(query);
    const normalizedQueryKey = queryKey(game, normalizedQuery);
    const pricedOn = todayUTC();
    const cached = await this.cachedSearch(c, game, normalizedQuery, normalizedQueryKey, pricedOn);
    if (cached != null) return cached;

    this.logCache(c, 'pricing.search.cache', 'miss', 0);
    return CardPricingRepository.withPricingLock(
      c,
      {
        game,
        key: `pricing:search:${pricedOn}:${game}:${normalizedQueryKey}`,
        keyType: 'search',
        pricedOn,
      },
      async transaction => {
        const populated = await this.cachedSearch(c, game, normalizedQuery, normalizedQueryKey, pricedOn, transaction);
        if (populated != null) return populated;

        const rawCards = await c.get('tcggo').searchCards(game, normalizedQuery);
        const normalizedCards = rawCards.flatMap(raw => {
          const card = normalizeTCGGOCard(raw);
          return card == null ? [] : [{ card, raw }];
        });
        const rows = await Promise.all(
          normalizedCards.map(({ card, raw }) =>
            CardPricingRepository.upsertCardPrice(
              c,
              {
                game,
                card,
                raw,
                pricedOn,
                source: c.get('tcggo').source,
              },
              transaction,
            ),
          ),
        );
        await CardPricingRepository.upsertSearch(
          c,
          {
            game,
            queryKey: normalizedQueryKey,
            pricedOn,
            tcggoCardIds: rows.map(row => row.tcggoCardId),
          },
          transaction,
        );
        this.logCache(c, 'pricing.search.cache', 'set', rows.length);

        return { normalizedQuery, matches: rows.map(row => serializePricedCard(game, row)) };
      },
    );
  }

  static async ownedPrices(c: HonoContext, game?: CardGame): Promise<OwnedCardPriceResponse[]> {
    const cards = CardPricingRepository.listOwnedCards(c, await CardRepository.list(c), game);
    return Promise.all(cards.map(card => this.priceOwnedCard(c, card)));
  }

  private static async priceOwnedCard(c: HonoContext, card: CardWithQuantities): Promise<OwnedCardPriceResponse> {
    if (card.tcggoCardId != null) return this.priceOwnedCardById(c, card);

    const query = buildSearchQuery(card.name, card.cardNumber);
    const search = await this.searchAndPrice(c, card.game, query);
    const normalizedNumber = normalizeCardNumber(card.cardNumber);
    const numberMatch = search.matches.find(
      candidate => normalizeCardNumber(candidate.card_number) === normalizedNumber,
    );
    const normalizedName = normalizeName(card.name).toLowerCase();
    const matched =
      numberMatch ?? search.matches.find(candidate => normalizeName(candidate.name).toLowerCase() === normalizedName);
    if (matched == null) return { card_id: card.id, status: 'no_match' };

    await CardPricingRepository.setOwnedCardTcggoId(c, card.id, matched.tcggo_card_id);
    return this.makeOwnedResponse(card.id, matched);
  }

  private static async priceOwnedCardById(c: HonoContext, card: CardWithQuantities): Promise<OwnedCardPriceResponse> {
    const tcggoCardId = card.tcggoCardId;
    if (tcggoCardId == null) throw new Error('TCGGO card id is required for an id-based lookup');

    const pricedOn = todayUTC();
    const cached = await CardPricingRepository.getCachedCardPrice(c, card.game, tcggoCardId, pricedOn);
    if (cached != null) {
      this.logCache(c, 'pricing.owned.cache', 'hit', 1, card.id);
      return this.makeOwnedResponse(card.id, serializePricedCard(card.game, cached));
    }

    this.logCache(c, 'pricing.owned.cache', 'miss', 0, card.id);
    return CardPricingRepository.withPricingLock(
      c,
      {
        game: card.game,
        key: `pricing:card:${pricedOn}:${card.game}:${tcggoCardId}`,
        keyType: 'card',
        pricedOn,
      },
      async transaction => {
        const populated = await CardPricingRepository.getCachedCardPrice(
          c,
          card.game,
          tcggoCardId,
          pricedOn,
          transaction,
        );
        if (populated != null) {
          this.logCache(c, 'pricing.owned.cache', 'hit', 1, card.id);
          return this.makeOwnedResponse(card.id, serializePricedCard(card.game, populated));
        }

        const raw = await c.get('tcggo').getCardById(card.game, tcggoCardId);
        if (raw == null) return { card_id: card.id, status: 'no_match' };

        const normalized = normalizeTCGGOCard(raw);
        if (normalized == null) return { card_id: card.id, status: 'no_match' };

        const row = await CardPricingRepository.upsertCardPrice(
          c,
          {
            game: card.game,
            card: normalized,
            raw,
            pricedOn,
            source: c.get('tcggo').source,
          },
          transaction,
        );
        this.logCache(c, 'pricing.owned.cache', 'set', 1, card.id);
        return this.makeOwnedResponse(card.id, serializePricedCard(card.game, row));
      },
    );
  }

  private static async cachedSearch(
    c: HonoContext,
    game: CardGame,
    normalizedQuery: string,
    normalizedQueryKey: string,
    pricedOn: string,
    database?: PricingDatabase,
  ): Promise<{ normalizedQuery: string; matches: PricedCardResponse[] } | undefined> {
    const cachedSearch = await CardPricingRepository.getCachedSearch(c, game, normalizedQueryKey, pricedOn, database);
    if (cachedSearch == null) return undefined;

    const rows = await CardPricingRepository.getCachedCardPrices(
      c,
      game,
      cachedSearch.tcggoCardIds,
      pricedOn,
      database,
    );
    const rowsById = new Map(rows.map(row => [row.tcggoCardId, row]));
    const matches = cachedSearch.tcggoCardIds.flatMap(id => {
      const row = rowsById.get(id);
      return row == null ? [] : [serializePricedCard(game, row)];
    });
    this.logCache(c, 'pricing.search.cache', 'hit', matches.length);
    return { normalizedQuery, matches };
  }

  private static makeOwnedResponse(cardId: string, price: PricedCardResponse): OwnedCardPriceResponse {
    return {
      card_id: cardId,
      status: price.headline == null ? 'no_price' : 'priced',
      price,
    };
  }

  private static logCache(
    c: HonoContext,
    event: string,
    cacheStatus: 'hit' | 'miss' | 'set',
    resultCount: number,
    cardId?: string,
  ) {
    logInfo(
      withRequestLogger(c, { component: 'card-pricing' }),
      {
        event,
        outcome: 'success',
        cache_status: cacheStatus,
        result_count: resultCount,
        card_id: cardId,
      },
      'Completed a card pricing cache lookup.',
    );
  }
}
