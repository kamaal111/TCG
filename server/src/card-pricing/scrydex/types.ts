import z from 'zod';

export const ScrydexImageSchema = z
  .object({
    type: z.unknown().optional(),
    small: z.unknown().optional(),
    medium: z.unknown().optional(),
    large: z.unknown().optional(),
  })
  .catchall(z.unknown());

export const ScrydexPriceMovementSchema = z
  .object({
    price_change: z.unknown().optional(),
    percent_change: z.unknown().optional(),
  })
  .catchall(z.unknown());

export const ScrydexRawPriceSchema = z
  .object({
    condition: z.unknown().optional(),
    type: z.unknown().optional(),
    low: z.unknown().optional(),
    market: z.unknown().optional(),
    currency: z.unknown().optional(),
    trends: z
      .object({
        days_7: ScrydexPriceMovementSchema.optional(),
        days_30: ScrydexPriceMovementSchema.optional(),
      })
      .catchall(z.unknown())
      .optional(),
  })
  .catchall(z.unknown());

export const ScrydexVariantSchema = z
  .object({
    name: z.unknown().optional(),
    images: z.array(ScrydexImageSchema).optional(),
    prices: z.array(ScrydexRawPriceSchema).optional(),
  })
  .catchall(z.unknown());

export const ScrydexRawCardSchema = z
  .object({
    id: z.unknown().optional(),
    name: z.unknown().optional(),
    number: z.unknown().optional(),
    printed_number: z.unknown().optional(),
    rarity: z.unknown().optional(),
    language_code: z.unknown().optional(),
    images: z.array(ScrydexImageSchema).optional(),
    variants: z.array(ScrydexVariantSchema).optional(),
  })
  .catchall(z.unknown());

export const ScrydexSearchResponseSchema = z
  .object({
    data: z.array(z.unknown()),
    totalCount: z.number().int().nonnegative().optional(),
    total_count: z.number().int().nonnegative().optional(),
  })
  .catchall(z.unknown());

export type ScrydexRawCard = z.infer<typeof ScrydexRawCardSchema>;
export type ScrydexRawPrice = z.infer<typeof ScrydexRawPriceSchema>;
