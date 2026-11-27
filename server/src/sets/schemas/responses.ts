import { z } from 'zod';

import { PricedCardSchema } from '../../card-pricing/schemas/responses.ts';
import { paginatedResponseSchema } from '../../schemas/pagination.ts';

const ProgressSchema = z.object({ collected: z.int().nonnegative(), total: z.int().nonnegative() });

const SetSummarySchema = ProgressSchema.extend({
  id: z.string(),
  name: z.string(),
  code: z.string().optional(),
  language: z.string().optional(),
  release_date: z.string().optional(),
  logo: z.url().optional(),
  symbol: z.url().optional(),
}).meta({ $id: 'SetSummary' });

const ChecklistCardSchema = z
  .object({
    number: z.string(),
    printed_number: z.string(),
    name: z.string(),
    image_url: z.url().optional(),
    owned: z.boolean(),
  })
  .meta({ $id: 'SetChecklistCard' });

export const SetListResponseSchema = paginatedResponseSchema(SetSummarySchema);
export const ChecklistResponseSchema = paginatedResponseSchema(ChecklistCardSchema).extend({ set: SetSummarySchema });
export const SetCardDetailResponseSchema = z.object({ printings: z.array(PricedCardSchema) });
