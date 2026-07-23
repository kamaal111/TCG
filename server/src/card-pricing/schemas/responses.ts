import { z } from '@hono/zod-openapi';

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

export const CurrencySchema = z.enum(Object.values(CURRENCIES)).openapi('Currency', {
  title: 'Currency',
  description: 'ISO 4217 currency supported by the pricing service.',
  example: CURRENCIES.USD,
});

const AmountSchema = z.number().nonnegative();

export const PriceHeadlineSchema = z
  .object({
    amount: AmountSchema.openapi({ description: 'Headline market amount', example: 146.69 }),
    currency: CurrencySchema,
    metric: z.literal(Object.values(PRICE_HEADLINE_METRICS)).openapi({
      description: 'Raw-market metric used for the headline',
      example: PRICE_HEADLINE_METRICS.LOWEST_NEAR_MINT,
    }),
  })
  .openapi('PriceHeadline', {
    title: 'Price Headline',
    description: 'Lowest raw Near Mint market price',
    example: { amount: 146.69, currency: 'USD', metric: PRICE_HEADLINE_METRICS.LOWEST_NEAR_MINT },
  });

const PriceMovementSchema = z
  .object({
    price_change: z.number().openapi({ description: 'Absolute market-price change', example: 7.36 }),
    percent_change: z.number().openapi({ description: 'Percentage market-price change', example: 4.46 }),
  })
  .openapi('PriceMovement', {
    title: 'Price Movement',
    description: 'Market-price movement over a fixed period',
    example: { price_change: 7.36, percent_change: 4.46 },
  });

export const MarketPriceSchema = z
  .object({
    condition: z
      .literal('near_mint')
      .openapi({ description: 'Normalized raw-card condition selected for pricing', example: 'near_mint' }),
    currency: CurrencySchema,
    low: AmountSchema.optional().openapi({ description: 'Lowest known Near Mint price', example: 146.69 }),
    market: AmountSchema.optional().openapi({ description: 'Average Near Mint market price', example: 172.42 }),
    trend_7d: PriceMovementSchema.optional(),
    trend_30d: PriceMovementSchema.optional(),
  })
  .openapi('MarketPrice', {
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
    id: z.uuid().openapi({
      description: 'Stable identifier for this priced-card record',
      example: '550e8400-e29b-41d4-a716-446655440000',
    }),
    game: z.enum(CARD_GAMES).openapi({ description: 'Trading card game', example: 'pokemon' }),
    name: z.string().openapi({ description: 'Card name', example: 'Giratina VSTAR' }),
    card_number: z.string().openapi({ description: 'Card number', example: 'GG69' }),
    rarity: z.string().optional().openapi({ description: 'Card rarity when provided', example: 'Secret Rare' }),
    image_url: z.url().optional().openapi({
      description: 'Card image URL when provided',
      example: 'https://images.example.com/giratina-vstar-gg69.png',
    }),
    headline: PriceHeadlineSchema.optional().openapi({ description: 'Primary price when available' }),
    market: MarketPriceSchema.optional().openapi({ description: 'Near Mint market pricing when available' }),
    priced_on: ApiCommonDatetimeShape.openapi({
      description: 'UTC pricing date',
      example: '2026-07-23T00:00:00.000Z',
    }),
    fetched_at: ApiCommonDatetimeShape.openapi({
      description: 'Time the price was fetched from the configured source',
      example: '2026-07-23T10:30:00.000Z',
    }),
  })
  .openapi('PricedCard', {
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
    matches: z.array(PricedCardSchema).openapi({ description: 'Ordered matching cards' }),
  })
  .openapi('PricingSearchResponse', {
    title: 'Pricing Search Response',
    description: 'Card pricing search results',
    example: {
      matches: [],
    },
  });

export const OwnedCardPriceSchema = z
  .object({
    card_id: z.uuid().openapi({
      description: 'Owned card identifier',
      example: '550e8400-e29b-41d4-a716-446655440000',
    }),
    status: z.enum(Object.values(OWNED_CARD_PRICE_STATUSES)).openapi({
      description: 'Pricing result for the owned card; unavailable means pricing is temporarily busy.',
      example: OWNED_CARD_PRICE_STATUSES.PRICED,
    }),
    priced_card: PricedCardSchema.optional().openapi({ description: 'Matched price when available' }),
  })
  .openapi('OwnedCardPrice', {
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
