import { convertMoney } from './conversion.ts';
import type { Currency } from './currencies.ts';
import type { ForexSnapshot } from './schemas/responses.ts';
import type { PricedCardResponse } from '../card-pricing/schemas/responses.ts';

export interface ForexDisplayContext {
  currency: Currency;
  snapshot?: ForexSnapshot;
}

export function displayPurchase(amount: string, source: Currency, context: ForexDisplayContext) {
  const converted = convertMoney(amount, { source, target: context.currency, snapshot: context.snapshot });

  return {
    amount: converted ?? amount,
    currency: converted != null ? context.currency : source,
    conversion_unavailable: converted == null,
  };
}

export function displayPricedCard(card: PricedCardResponse, context: ForexDisplayContext): PricedCardResponse {
  const convert = (amount: number, source: Currency) => {
    if (source === context.currency) {
      return amount;
    }

    const converted = convertMoney(amount.toFixed(6), { source, target: context.currency, snapshot: context.snapshot });

    if (converted == null) {
      return undefined;
    }

    return Number(converted);
  };

  const headlineAmount = card.headline != null ? convert(card.headline.amount, card.headline.currency) : undefined;

  const headline =
    card.headline != null && headlineAmount != null
      ? { ...card.headline, amount: headlineAmount, currency: context.currency }
      : card.headline;

  const market = card.market;
  const low = market?.low != null ? convert(market.low, market.currency) : undefined;
  const average = market?.market != null ? convert(market.market, market.currency) : undefined;
  const change7d = market?.trend_7d != null ? convert(market.trend_7d.price_change, market.currency) : undefined;
  const change30d = market?.trend_30d != null ? convert(market.trend_30d.price_change, market.currency) : undefined;

  const unavailable = [
    [card.headline?.amount, headlineAmount],
    [market?.low, low],
    [market?.market, average],
    [market?.trend_7d?.price_change, change7d],
    [market?.trend_30d?.price_change, change30d],
  ].some(([original, converted]) => original != null && converted == null);

  return {
    ...card,
    display: {
      preferred_currency: context.currency,
      conversion_unavailable: unavailable,
      headline,
      market:
        market != null && !unavailable
          ? {
              ...market,
              currency: context.currency,
              low,
              market: average,
              trend_7d:
                market.trend_7d != null && change7d != null
                  ? { ...market.trend_7d, price_change: change7d }
                  : undefined,
              trend_30d:
                market.trend_30d != null && change30d != null
                  ? { ...market.trend_30d, price_change: change30d }
                  : undefined,
            }
          : market,
    },
  };
}
