import { CARD_CONDITION_MAP, CARD_CONDITIONS, type CardCondition } from '../../cards/types.ts';
import type { ConditionPriceResponse, ConditionValueResponse } from '../schemas/responses.ts';
import { CONDITION_VALUE_BASIS_MAP, QUOTED_CONDITIONS } from '../types.ts';

const ADJACENT_CONDITION_FACTOR = 0.9;

export function resolveConditionValues(prices: readonly ConditionPriceResponse[]): ConditionValueResponse[] {
  const quotes = new Map(prices.map(price => [price.condition, price]));

  const bands = QUOTED_CONDITIONS.map(condition => {
    const quote = quotes.get(condition);
    const amount = quote?.market ?? quote?.low;

    return quote != null && amount != null
      ? ({
          amount,
          currency: quote.currency,
          basis: quote.market == null ? CONDITION_VALUE_BASIS_MAP.LOW : CONDITION_VALUE_BASIS_MAP.MARKET,
        } as const)
      : undefined;
  });

  return CARD_CONDITIONS.flatMap<ConditionValueResponse>(condition => {
    const index = QUOTED_CONDITIONS.indexOf(
      condition === CARD_CONDITION_MAP.MINT ? CARD_CONDITION_MAP.NEAR_MINT : condition,
    );

    const direct = bands[index];

    if (direct != null) {
      return [{ condition, ...direct }];
    }

    const better = bands.findLastIndex((quote, position) => position < index && quote != null);
    const worse = bands.findIndex((quote, position) => position > index && quote != null);
    const betterQuote = bands[better];
    const worseQuote = bands[worse];

    if (
      betterQuote != null &&
      worseQuote != null &&
      betterQuote.currency === worseQuote.currency &&
      betterQuote.amount > worseQuote.amount
    ) {
      const fraction = (index - better) / (worse - better);
      const amount = betterQuote.amount + (worseQuote.amount - betterQuote.amount) * fraction;

      if (amount > worseQuote.amount && amount < betterQuote.amount) {
        return [{ condition, amount, currency: betterQuote.currency, basis: CONDITION_VALUE_BASIS_MAP.INTERPOLATED }];
      }
    }

    for (let distance = 1; distance < bands.length; distance += 1) {
      for (const offset of [-distance, distance]) {
        const anchor = bands[index + offset];

        if (anchor == null) {
          continue;
        }

        const amount = anchor.amount * ADJACENT_CONDITION_FACTOR ** -offset;
        const movesTowardCondition = offset < 0 ? amount < anchor.amount : amount > anchor.amount;

        if (Number.isFinite(amount) && movesTowardCondition) {
          return [{ condition, amount, currency: anchor.currency, basis: CONDITION_VALUE_BASIS_MAP.ADJUSTED }];
        }
      }
    }

    return [];
  });
}

export function conditionValue(
  prices: readonly ConditionValueResponse[] | undefined,
  condition: CardCondition,
): ConditionValueResponse | undefined {
  return prices?.find(value => value.condition === condition);
}
