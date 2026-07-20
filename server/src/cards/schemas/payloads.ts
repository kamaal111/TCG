import { z } from '@hono/zod-openapi';

import { CARD_CONDITIONS } from '../../db/schema/cards.ts';
import { CardConditionQuantitySchema, CardCoreFieldsSchema } from './fields.ts';

export const UpsertCardSchema = CardCoreFieldsSchema.extend({
  notes: z
    .string()
    .trim()
    .max(2000)
    .transform(notes => (notes === '' ? undefined : notes))
    .optional()
    .openapi({
      description: 'Optional notes about this owned card',
      example: 'Alternate art',
    }),
  quantities: z
    .array(CardConditionQuantitySchema)
    .min(1)
    .max(CARD_CONDITIONS.length)
    .refine(quantities => new Set(quantities.map(quantity => quantity.condition)).size === quantities.length, {
      message: 'Conditions must be unique',
    })
    .openapi({ description: 'Owned quantities grouped by condition' }),
}).openapi('UpsertCard', {
  title: 'Upsert Card',
  description: 'Fields used to create or fully replace an owned card entry',
  example: {
    game: 'one_piece',
    name: 'Monkey D. Luffy',
    set_name: 'Romance Dawn',
    card_number: 'OP01-003',
    notes: 'Alternate art',
    quantities: [{ condition: 'near_mint', quantity: 2 }],
  },
});

export type UpsertCard = z.infer<typeof UpsertCardSchema>;
