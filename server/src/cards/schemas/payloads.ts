import { z } from 'zod';

import { CardPurchaseInputSchema, CardCoreFieldsSchema, CardIdSchema } from './fields.ts';
import { CARD_CONDITIONS, MAX_COPIES_PER_CONDITION } from '../../db/schema/cards.ts';
import { purchaseQuantities } from '../utils/quantities.ts';

const MAX_CONDITIONS = CARD_CONDITIONS.length;

export const UpsertCardSchema = CardCoreFieldsSchema.extend({
  notes: z
    .string()
    .trim()
    .max(2000)
    .transform(notes => (notes === '' ? undefined : notes))
    .optional()
    .meta({
      description: 'Optional notes about this owned card',
      example: 'Alternate art',
    }),
  purchases: z
    .array(CardPurchaseInputSchema)
    .min(1)
    .max(MAX_CONDITIONS * MAX_COPIES_PER_CONDITION)
    .meta({
      description:
        'Complete list of owned purchases. On update, retain IDs to edit purchases, omit IDs to add purchases, and omit existing purchases to remove them. Condition totals are derived from this list.',
    }),
})
  .superRefine((values, context) => {
    const ids = values.purchases.flatMap(purchase => (purchase.id == null ? [] : [purchase.id]));

    if (new Set(ids).size !== ids.length) {
      context.addIssue({ code: 'custom', path: ['purchases'], message: 'Purchase IDs must be unique' });
    }

    if (purchaseQuantities(values.purchases).some(({ quantity }) => quantity > MAX_COPIES_PER_CONDITION)) {
      context.addIssue({
        code: 'custom',
        path: ['purchases'],
        message: `Each condition can contain at most ${MAX_COPIES_PER_CONDITION} cards`,
      });
    }
  })
  .meta({
    $id: 'UpsertCard',
    title: 'Upsert Card',
    description: 'Fields used to create or fully replace an owned card entry',
    example: {
      game: 'one_piece',
      name: 'Monkey D. Luffy',
      set_name: 'Romance Dawn',
      card_number: 'OP01-003',
      notes: 'Alternate art',
      purchases: [{ condition: 'near_mint', quantity: 2, purchase_price: null, currency: null }],
    },
  });

export type UpsertCard = z.infer<typeof UpsertCardSchema>;

export const DeleteCardsSchema = z
  .object({
    card_ids: z.array(CardIdSchema).meta({ description: 'Card entries to delete; duplicates are ignored' }),
  })
  .meta({ $id: 'DeleteCards', title: 'Delete Cards' });
