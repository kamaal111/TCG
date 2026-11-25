import z from 'zod';

import { SCRYDEX_PRICE_TYPE_MAP } from './types.ts';

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

const NonEmptyStringSchema = z.string().trim().nonempty();

export const ScrydexGradedPriceSchema = z.looseObject({
  type: z.literal(SCRYDEX_PRICE_TYPE_MAP.GRADED),
  grade: NonEmptyStringSchema,
  company: NonEmptyStringSchema,
  currency: z.string(),
  is_perfect: z.boolean().optional(),
  is_signed: z.boolean().optional(),
  is_error: z.boolean().optional(),
  low: z.number().nullish(),
  market: z.number().nullish(),
});

const PopulationGradeSchema = z.looseObject({ grade: NonEmptyStringSchema, count: z.int().nonnegative() });

const PopulationReportSchema = z.looseObject({
  company: NonEmptyStringSchema,
  total: z.int().nonnegative().optional(),
  grade_total: z.int().nonnegative().optional(),
  qualified_grade_total: z.int().nonnegative().optional(),
  half_grade_total: z.int().nonnegative().optional(),
  external_id: z.string().optional(),
  grades: z
    .array(PopulationGradeSchema.optional().catch(undefined))
    .transform(grades => grades.filter(grade => grade != null)),
});

export const ScrydexVariantSchema = z
  .object({
    name: z.unknown().optional(),
    images: z.array(ScrydexImageSchema).optional(),
    prices: z.array(ScrydexRawPriceSchema).optional(),
    pop_reports: z
      .array(PopulationReportSchema.optional().catch(undefined))
      .transform(reports => reports.filter(report => report != null))
      .optional()
      .catch(undefined),
  })
  .catchall(z.unknown());

export const ScrydexRawCardSchema = z
  .object({
    id: z.unknown().optional(),
    name: z.unknown().optional(),
    number: z.unknown().optional(),
    printed_number: z.unknown().optional(),
    expansion: z
      .object({ name: z.string().trim().nonempty().optional().catch(undefined) })
      .catchall(z.unknown())
      .optional()
      .catch(undefined),
    artist: z.unknown().optional(),
    rarity: z.unknown().optional(),
    language_code: z.unknown().optional(),
    images: z.array(ScrydexImageSchema).optional(),
    variants: z.array(ScrydexVariantSchema).optional(),
  })
  .catchall(z.unknown());

export const ScrydexCardResponseSchema = z.object({ data: ScrydexRawCardSchema }).catchall(z.unknown());

export const ScrydexSearchResponseSchema = z
  .object({
    data: z.array(z.unknown()),
    totalCount: z.number().int().nonnegative().optional(),
    total_count: z.number().int().nonnegative().optional(),
  })
  .catchall(z.unknown());

export type ScrydexRawCard = z.infer<typeof ScrydexRawCardSchema>;

export type ScrydexRawPrice = z.infer<typeof ScrydexRawPriceSchema>;
