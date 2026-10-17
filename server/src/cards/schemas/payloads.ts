import { z } from 'zod';

import { CardPurchaseInputSchema, CardCoreFieldsSchema, CardIdSchema, CardPurchaseSchema } from './fields.ts';
import { CARD_CONDITIONS, MAX_COPIES_PER_CONDITION } from '../../db/schema/cards.ts';
import { purchaseQuantities } from '../utils/quantities.ts';

const MAX_CONDITIONS = CARD_CONDITIONS.length;

const CardInputSchema = CardCoreFieldsSchema.extend({
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
});

function validatePurchases(values: z.infer<typeof CardInputSchema>, context: z.RefinementCtx) {
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
}

export const UpsertCardSchema = CardInputSchema.superRefine(validatePurchases).meta({
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

export const ImportCardSchema = CardInputSchema.extend({
  id: CardIdSchema.meta({
    description: 'Source card identifier used to create or replace cards owned by the importing account',
    example: '550e8400-e29b-41d4-a716-446655440000',
  }),
  notes: UpsertCardSchema.shape.notes
    .meta({ description: 'Optional notes preserved from the backup', example: 'Alternate art' })
    .nullable()
    .transform(notes => notes ?? undefined),
  created_at: z.iso.datetime({ offset: true }).meta({
    description: 'Original creation timestamp preserved from the backup',
    example: '2026-07-20T10:30:00.000Z',
  }),
  updated_at: z.iso.datetime({ offset: true }).meta({
    description: 'Original last update timestamp preserved from the backup',
    example: '2026-07-20T10:30:00.000Z',
  }),
  purchases: z
    .array(
      CardPurchaseSchema.omit({ display_price: true })
        .extend({
          purchase_price: CardPurchaseSchema.shape.purchase_price.optional().default(null),
          currency: CardPurchaseSchema.shape.currency.optional().default(null),
          automatic_price_date: z.iso.date().nullish().default(null).meta({
            description: 'Original market pricing day; requires a purchase price when provided',
            example: '2026-07-20',
          }),
        })
        .superRefine((purchase, context) => {
          if ((purchase.purchase_price == null) !== (purchase.currency == null)) {
            context.addIssue({
              code: 'custom',
              path: ['purchase_price'],
              message: 'Purchase price and currency must be provided together',
            });
          }

          if (purchase.automatic_price_date != null && purchase.purchase_price == null) {
            context.addIssue({
              code: 'custom',
              path: ['automatic_price_date'],
              message: 'Automatic price date requires a purchase price',
            });
          }
        }),
    )
    .min(1)
    .max(MAX_CONDITIONS * MAX_COPIES_PER_CONDITION)
    .meta({ description: 'Purchase batches preserved from the backup, including exact costs and currencies' }),
})
  .superRefine(validatePurchases)
  .meta({
    $id: 'ImportCard',
    title: 'Import Card',
    description: 'An owned card from a backup, preserving source identity, timestamps, and purchase history',
    example: {
      id: '550e8400-e29b-41d4-a716-446655440000',
      game: 'one_piece',
      name: 'Monkey D. Luffy',
      set_name: 'Romance Dawn',
      card_number: 'OP01-003',
      notes: 'Alternate art',
      created_at: '2026-07-20T10:30:00.000Z',
      updated_at: '2026-07-20T10:30:00.000Z',
      purchases: [
        {
          id: '550e8400-e29b-41d4-a716-446655440001',
          condition: 'near_mint',
          quantity: 2,
          purchase_price: '2.50',
          currency: 'USD',
          automatic_price_date: '2026-07-20',
        },
      ],
    },
  });

export const ImportCardsSchema = z
  .object({
    cards: z.array(ImportCardSchema).meta({
      description:
        'Cards to import; matching owned identifiers replace changed cards and their complete purchase history',
    }),
  })
  .meta({
    $id: 'ImportCards',
    title: 'Import Cards',
    description: "A collection backup to import into the authenticated user's account",
    example: {
      cards: [
        {
          id: '550e8400-e29b-41d4-a716-446655440000',
          game: 'one_piece',
          name: 'Monkey D. Luffy',
          set_name: 'Romance Dawn',
          card_number: 'OP01-003',
          notes: 'Alternate art',
          created_at: '2026-07-20T10:30:00.000Z',
          updated_at: '2026-07-20T10:30:00.000Z',
          purchases: [
            {
              id: '550e8400-e29b-41d4-a716-446655440001',
              condition: 'near_mint',
              quantity: 2,
              purchase_price: '2.50',
              currency: 'USD',
              automatic_price_date: '2026-07-20',
            },
          ],
        },
      ],
    },
  });

export type ImportCard = z.infer<typeof ImportCardSchema>;
