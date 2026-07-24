import { z } from '@hono/zod-openapi';

import { CARD_GAMES } from '../../db/schema/cards.ts';
import { ApiCommonDatetimeShape } from '../../schemas/common.ts';

const CurrencySchema = z.string().min(3).max(3);
const AmountSchema = z.number().nonnegative();

export const PriceHeadlineSchema = z
  .object({
    amount: AmountSchema.openapi({ description: 'Headline market amount', example: 146.69 }),
    currency: CurrencySchema.openapi({ description: 'ISO currency returned by TCGGO', example: 'EUR' }),
    metric: z.literal('lowest_near_mint').openapi({
      description: 'Cardmarket metric used for the headline',
      example: 'lowest_near_mint',
    }),
  })
  .openapi('PriceHeadline', {
    title: 'Price Headline',
    description: 'Primary Cardmarket near-mint price',
    example: { amount: 146.69, currency: 'EUR', metric: 'lowest_near_mint' },
  });

export const CardMarketPriceSchema = z
  .object({
    currency: CurrencySchema.openapi({ description: 'ISO currency returned by Cardmarket', example: 'EUR' }),
    lowest_near_mint: AmountSchema.optional().openapi({
      description: 'Lowest near-mint listing',
      example: 146.69,
    }),
    average_7d: AmountSchema.optional().openapi({ description: 'Seven-day average', example: 151.24 }),
    average_30d: AmountSchema.optional().openapi({ description: 'Thirty-day average', example: 143.88 }),
    trend: z
      .enum(['up', 'down', 'flat'])
      .optional()
      .openapi({ description: 'Seven-day average compared with the thirty-day average', example: 'up' }),
  })
  .openapi('CardMarketPrice', {
    title: 'Cardmarket Price',
    description: 'Normalized Cardmarket pricing metrics',
    example: {
      currency: 'EUR',
      lowest_near_mint: 146.69,
      average_7d: 151.24,
      average_30d: 143.88,
      trend: 'up',
    },
  });

export const TCGPlayerPriceSchema = z
  .object({
    currency: CurrencySchema.openapi({ description: 'ISO currency returned by TCGplayer', example: 'USD' }),
    market_price: AmountSchema.optional().openapi({ description: 'Current market price', example: 172.42 }),
    mid_price: AmountSchema.optional().openapi({ description: 'Current midpoint price', example: 178.1 }),
  })
  .openapi('TCGPlayerPrice', {
    title: 'TCGplayer Price',
    description: 'Normalized TCGplayer pricing metrics',
    example: { currency: 'USD', market_price: 172.42, mid_price: 178.1 },
  });

export const PricedCardSchema = z
  .object({
    tcggo_card_id: z
      .string()
      .openapi({ description: 'Stable TCGGO card identifier', example: 'pokemon-giratina-vstar-gg69' }),
    game: z.enum(CARD_GAMES).openapi({ description: 'Trading card game', example: 'pokemon' }),
    name: z.string().openapi({ description: 'Card name returned by TCGGO', example: 'Giratina VSTAR' }),
    card_number: z.string().openapi({ description: 'Card number returned by TCGGO', example: 'GG69' }),
    rarity: z.string().optional().openapi({ description: 'Card rarity when provided', example: 'Secret Rare' }),
    image_url: z.url().optional().openapi({
      description: 'Card image URL when provided',
      example: 'https://images.example.com/giratina-vstar-gg69.png',
    }),
    headline: PriceHeadlineSchema.optional().openapi({ description: 'Primary price when available' }),
    cardmarket: CardMarketPriceSchema.optional().openapi({ description: 'Cardmarket metrics when available' }),
    tcgplayer: TCGPlayerPriceSchema.optional().openapi({ description: 'TCGplayer metrics when available' }),
    priced_on: z.iso.date().openapi({ description: 'UTC pricing date', example: '2026-07-23' }),
    fetched_at: ApiCommonDatetimeShape.openapi({
      description: 'Time the price was fetched from the configured source',
      example: '2026-07-23T10:30:00.000Z',
    }),
  })
  .openapi('PricedCard', {
    title: 'Priced Card',
    description: 'A trading card with normalized daily market pricing',
    example: {
      tcggo_card_id: 'pokemon-giratina-vstar-gg69',
      game: 'pokemon',
      name: 'Giratina VSTAR',
      card_number: 'GG69',
      rarity: 'Secret Rare',
      headline: { amount: 146.69, currency: 'EUR', metric: 'lowest_near_mint' },
      cardmarket: {
        currency: 'EUR',
        lowest_near_mint: 146.69,
        average_7d: 151.24,
        average_30d: 143.88,
        trend: 'up',
      },
      priced_on: '2026-07-23',
      fetched_at: '2026-07-23T10:30:00.000Z',
    },
  });

export const PricingSearchResponseSchema = z
  .object({
    query: z.string().openapi({ description: 'Original search query', example: 'Charizard ex 199' }),
    normalized_query: z.string().openapi({ description: 'Whitespace-normalized query', example: 'Charizard ex 199' }),
    game: z.enum(CARD_GAMES).openapi({ description: 'Trading card game searched', example: 'pokemon' }),
    status: z.enum(['ok', 'no_results']).openapi({ description: 'Whether TCGGO returned matches', example: 'ok' }),
    matches: z.array(PricedCardSchema).openapi({ description: 'Ordered matching cards' }),
  })
  .openapi('PricingSearchResponse', {
    title: 'Pricing Search Response',
    description: 'Card pricing search results',
    example: {
      query: 'Charizard ex 199',
      normalized_query: 'Charizard ex 199',
      game: 'pokemon',
      status: 'ok',
      matches: [],
    },
  });

export const OwnedCardPriceSchema = z
  .object({
    card_id: z.uuid().openapi({
      description: 'Owned card identifier',
      example: '550e8400-e29b-41d4-a716-446655440000',
    }),
    status: z
      .enum(['priced', 'no_match', 'no_price'])
      .openapi({ description: 'Pricing result for the owned card', example: 'priced' }),
    price: PricedCardSchema.optional().openapi({ description: 'Matched price when available' }),
  })
  .openapi('OwnedCardPrice', {
    title: 'Owned Card Price',
    description: 'Daily pricing result for one owned card',
    example: {
      card_id: '550e8400-e29b-41d4-a716-446655440000',
      status: 'priced',
    },
  });

export const OwnedPricingResponseSchema = z
  .object({
    prices: z.array(OwnedCardPriceSchema).openapi({ description: 'Pricing results for the owned collection' }),
  })
  .openapi('OwnedPricingResponse', {
    title: 'Owned Pricing Response',
    description: 'Batch pricing results for the authenticated collection',
    example: { prices: [] },
  });

export type PricedCardResponse = z.infer<typeof PricedCardSchema>;
export type PricingSearchResponse = z.infer<typeof PricingSearchResponseSchema>;
export type OwnedCardPriceResponse = z.infer<typeof OwnedCardPriceSchema>;
export type OwnedPricingResponse = z.infer<typeof OwnedPricingResponseSchema>;
