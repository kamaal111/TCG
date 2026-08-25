import { z } from 'zod';

import { CARD_GAMES } from '../../db/schema/cards.ts';
import { ApiCommonDatetimeShape } from '../../schemas/common.ts';
import { CURRENCIES } from '../types.ts';

export const PRICE_HEADLINE_METRICS = { LOWEST_NEAR_MINT: 'lowest_near_mint' } as const;

export const OWNED_CARD_PRICE_STATUSES = {
  PRICED: 'priced',
  NO_MATCH: 'no_match',
  NO_PRICE: 'no_price',
  UNAVAILABLE: 'unavailable',
} as const;

export const CurrencySchema = z.enum(Object.values(CURRENCIES)).meta({
  $id: 'Currency',
  title: 'Currency',
  description: 'ISO 4217 currency supported by the pricing service.',
  example: CURRENCIES.USD,
});

const AmountSchema = z.number().nonnegative();

export const PriceHeadlineSchema = z
  .object({
    amount: AmountSchema.meta({ description: 'Headline market amount', example: 146.69 }),
    currency: CurrencySchema,
    metric: z.literal(Object.values(PRICE_HEADLINE_METRICS)).meta({
      description: 'Raw-market metric used for the headline',
      example: PRICE_HEADLINE_METRICS.LOWEST_NEAR_MINT,
    }),
  })
  .meta({
    $id: 'PriceHeadline',
    title: 'Price Headline',
    description: 'Lowest raw Near Mint market price',
    example: { amount: 146.69, currency: 'USD', metric: PRICE_HEADLINE_METRICS.LOWEST_NEAR_MINT },
  });

const PriceMovementSchema = z
  .object({
    price_change: z.number().meta({ description: 'Absolute market-price change', example: 7.36 }),
    percent_change: z.number().meta({ description: 'Percentage market-price change', example: 4.46 }),
  })
  .meta({
    $id: 'PriceMovement',
    title: 'Price Movement',
    description: 'Market-price movement over a fixed period',
    example: { price_change: 7.36, percent_change: 4.46 },
  });

export const MarketPriceSchema = z
  .object({
    condition: z
      .literal('near_mint')
      .meta({ description: 'Normalized raw-card condition selected for pricing', example: 'near_mint' }),
    currency: CurrencySchema,
    low: AmountSchema.optional().meta({ description: 'Lowest known Near Mint price', example: 146.69 }),
    market: AmountSchema.optional().meta({ description: 'Average Near Mint market price', example: 172.42 }),
    trend_7d: PriceMovementSchema.optional(),
    trend_30d: PriceMovementSchema.optional(),
  })
  .meta({
    $id: 'MarketPrice',
    title: 'Market Price',
    description: 'Provider-neutral raw Near Mint market pricing',
    example: {
      condition: 'near_mint',
      currency: 'USD',
      low: 146.69,
      market: 172.42,
      trend_7d: { price_change: 7.36, percent_change: 4.46 },
      trend_30d: { price_change: 13.88, percent_change: 8.75 },
    },
  });

export const PricedCardSchema = z
  .object({
    id: z.uuid().meta({
      description: 'Stable identifier for this priced-card record',
      example: '550e8400-e29b-41d4-a716-446655440000',
    }),
    game: z.enum(CARD_GAMES).meta({ description: 'Trading card game', example: 'pokemon' }),
    name: z.string().meta({ description: 'Card name', example: 'Giratina VSTAR' }),
    card_number: z.string().meta({ description: 'Card number', example: 'GG69' }),
    rarity: z.string().optional().meta({ description: 'Card rarity when provided', example: 'Secret Rare' }),
    image_url: z.url().optional().meta({
      description: 'Card image URL when provided',
      example: 'https://images.example.com/giratina-vstar-gg69.png',
    }),
    headline: PriceHeadlineSchema.optional(),
    market: MarketPriceSchema.optional(),
    priced_on: ApiCommonDatetimeShape.meta({
      description: 'UTC pricing date',
      example: '2026-07-23T00:00:00.000Z',
    }),
    fetched_at: ApiCommonDatetimeShape.meta({
      description: 'Time the price was fetched from the configured source',
      example: '2026-07-23T10:30:00.000Z',
    }),
  })
  .meta({
    $id: 'PricedCard',
    title: 'Priced Card',
    description: 'A trading card with normalized daily market pricing',
    example: {
      id: '550e8400-e29b-41d4-a716-446655440000',
      game: 'pokemon',
      name: 'Giratina VSTAR',
      card_number: 'GG69',
      rarity: 'Secret Rare',
      headline: { amount: 146.69, currency: 'USD', metric: PRICE_HEADLINE_METRICS.LOWEST_NEAR_MINT },
      market: {
        condition: 'near_mint',
        currency: 'USD',
        low: 146.69,
        market: 172.42,
        trend_7d: { price_change: 7.36, percent_change: 4.46 },
        trend_30d: { price_change: 13.88, percent_change: 8.75 },
      },
      priced_on: '2026-07-23T00:00:00.000Z',
      fetched_at: '2026-07-23T10:30:00.000Z',
    },
  });

export const PricingSearchResponseSchema = z
  .object({
    matches: z.array(PricedCardSchema).meta({ description: 'Ordered matching cards' }),
  })
  .meta({
    $id: 'PricingSearchResponse',
    title: 'Pricing Search Response',
    description: 'Card pricing search results',
    example: {
      matches: [],
    },
  });

export const OwnedCardPriceSchema = z
  .object({
    card_id: z.uuid().meta({
      description: 'Owned card identifier',
      example: '550e8400-e29b-41d4-a716-446655440000',
    }),
    status: z.enum(Object.values(OWNED_CARD_PRICE_STATUSES)).meta({
      description: 'Pricing result for the owned card; unavailable means pricing is temporarily busy.',
      example: OWNED_CARD_PRICE_STATUSES.PRICED,
    }),
    priced_card: PricedCardSchema.optional(),
  })
  .meta({
    $id: 'OwnedCardPrice',
    title: 'Owned Card Price',
    description: 'Daily pricing result for one owned card',
    example: {
      card_id: '550e8400-e29b-41d4-a716-446655440000',
      status: 'priced',
    },
  });

export type PricedCardResponse = z.infer<typeof PricedCardSchema>;
export type PricingSearchResponse = z.infer<typeof PricingSearchResponseSchema>;
export type OwnedCardPriceResponse = z.infer<typeof OwnedCardPriceSchema>;
