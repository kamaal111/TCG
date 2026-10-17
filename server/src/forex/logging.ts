import type { HonoContext } from '../context.ts';
import type { ForexDisplayContext } from './display.ts';
import type { PricedCardResponse } from '../card-pricing/schemas/responses.ts';
import type { CardWithPriceResponse } from '../cards/schemas/responses.ts';
import { type DomainLogFields, type DomainLogger, getDomainLogger, getProcessLogger } from '../logging/index.ts';

export const FOREX_EVENTS = [
  'forex.collect.completed',
  'forex.collect.failed',
  'forex.snapshot.loaded',
  'forex.display.completed',
] as const;

type ForexLogFields = DomainLogFields<(typeof FOREX_EVENTS)[number]> & {
  rate_date?: string;
  collection_status?: string;
  base_currency?: string;
  result_count?: number;
  target_currency?: string;
  fallback_count?: number;
};

export const forexProcessLogger = (): DomainLogger<ForexLogFields> => getProcessLogger();

export const forexLogger = (c: HonoContext): DomainLogger<ForexLogFields> => getDomainLogger(c);

export function logDisplayPrices(
  c: HonoContext,
  context: ForexDisplayContext,
  cards: readonly (PricedCardResponse | CardWithPriceResponse)[],
) {
  let fallbackCount = 0;

  for (const card of cards) {
    const price = 'price' in card ? card.price.priced_card : card;
    fallbackCount += Number(price?.display?.conversion_unavailable === true);

    if ('purchases' in card) {
      fallbackCount += card.purchases.filter(batch => batch.display_price?.conversion_unavailable === true).length;
    }
  }

  const fields: ForexLogFields = {
    event: 'forex.display.completed',
    outcome: 'success',
    target_currency: context.currency,
    rate_date: context.snapshot?.date,
    result_count: cards.length,
    fallback_count: fallbackCount,
  };

  const logger = forexLogger(c);

  if (fallbackCount > 0) {
    logger.warn(fields, 'Prepared display prices with original-currency fallbacks.');
  } else {
    logger.info(fields, 'Prepared preferred-currency display prices.');
  }
}
