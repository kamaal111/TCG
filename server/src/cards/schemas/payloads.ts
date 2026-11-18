import { z } from 'zod';

import { IMPORT_CARD_EXAMPLE } from './examples.ts';
import { CardPurchaseInputSchema, CardCoreFieldsSchema, CardPurchaseSchema } from './fields.ts';
import { UuidSchema } from '../../schemas/common.ts';
import { CARD_CONDITIONS, MAX_COPIES_PER_CONDITION } from '../types.ts';
import { purchaseQuantities } from '../utils/quantities.ts';

const MAX_CONDITIONS = CARD_CONDITIONS.length;

const CardOwnershipSchema = z.strictObject({
  collection_id: UuidSchema.nullish(),
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
    .nonempty()
    .max(MAX_CONDITIONS * MAX_COPIES_PER_CONDITION)
    .meta({
      description:
        'Complete list of owned purchases. On update, retain IDs to edit purchases, omit IDs to add purchases, and omit existing purchases to remove them. Condition totals are derived from this list.',
    }),
});

function validatePurchases({ purchases }: Pick<UpdateCard, 'purchases'>, context: z.RefinementCtx) {
  const ids = purchases.flatMap(purchase => (purchase.id == null ? [] : [purchase.id]));

  if (new Set(ids).size !== ids.length) {
    context.addIssue({ code: 'custom', path: ['purchases'], message: 'Purchase IDs must be unique' });
  }

  if (purchaseQuantities(purchases).some(({ quantity }) => quantity > MAX_COPIES_PER_CONDITION)) {
    context.addIssue({
      code: 'custom',
      path: ['purchases'],
      message: `Each condition can contain at most ${MAX_COPIES_PER_CONDITION} cards`,
    });
  }
}

const SelectedPrintingSchema = UuidSchema.meta({ description: 'UUID of the selected catalog printing or variant' });

export const CreateCardSchema = CardOwnershipSchema.extend({
  priced_card_id: SelectedPrintingSchema,
})
  .superRefine(validatePurchases)
  .meta({
    $id: 'CreateCard',
    title: 'Create Card',
    description: 'Create an owned card from the selected catalog printing',
    example: {
      priced_card_id: '550e8400-e29b-41d4-a716-446655440000',
      notes: 'Alternate art',
      purchases: [{ condition: 'near_mint', quantity: 2, purchase_price: null, currency: null }],
    },
  });

export const UpdateCardSchema = CardOwnershipSchema.superRefine(validatePurchases).meta({
  $id: 'UpdateCard',
  title: 'Update Card',
  description: 'Replace ownership details for an existing card',
});

export type UpdateCard = z.infer<typeof CardOwnershipSchema>;

export const DeleteCardsSchema = z
  .object({
    card_ids: z.array(UuidSchema).meta({ description: 'Card entries to delete; duplicates are ignored' }),
  })
  .meta({ $id: 'DeleteCards', title: 'Delete Cards' });

const ImportedCardPurchaseSchema = CardPurchaseSchema.omit({ display_price: true })
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
  })
  .meta({ $id: 'ImportedCardPurchase', title: 'Imported Card Purchase' });

const ImportedCardFieldsSchema = CardOwnershipSchema.extend({
  id: UuidSchema.meta({
    description: 'Source card identifier used to create or replace cards owned by the importing account',
    example: '550e8400-e29b-41d4-a716-446655440000',
  }),
  notes: CardOwnershipSchema.shape.notes
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
    .array(ImportedCardPurchaseSchema)
    .nonempty()
    .max(MAX_CONDITIONS * MAX_COPIES_PER_CONDITION)
    .meta({ description: 'Purchase batches preserved from the backup, including exact costs and currencies' }),
});

export const ImportCardSchema = z
  .object({ ...ImportedCardFieldsSchema.shape, ...CardCoreFieldsSchema.shape })
  .superRefine(validatePurchases)
  .meta({
    $id: 'ImportCard',
    title: 'Import Card',
    description: 'An owned card from a backup, preserving source identity, timestamps, and purchase history',
    example: IMPORT_CARD_EXAMPLE,
  });

const CSVImportCardSchema = ImportedCardFieldsSchema.omit({ collection_id: true })
  .extend({ priced_card_id: SelectedPrintingSchema })
  .superRefine(validatePurchases)
  .meta({ $id: 'CSVImportCard', title: 'CSV Import Card' });

export const ImportCardsSchema = z.strictObject({ cards: z.array(CSVImportCardSchema) }).meta({
  $id: 'ImportCards',
  title: 'Import Cards',
  description: 'Import a batch of owned cards with a selected catalog printing for each entry',
  example: {
    cards: [
      {
        id: IMPORT_CARD_EXAMPLE.id,
        notes: IMPORT_CARD_EXAMPLE.notes,
        created_at: IMPORT_CARD_EXAMPLE.created_at,
        updated_at: IMPORT_CARD_EXAMPLE.updated_at,
        purchases: IMPORT_CARD_EXAMPLE.purchases,
        priced_card_id: '550e8400-e29b-41d4-a716-446655440010',
      },
    ],
  },
});

export type ImportCard = z.infer<typeof ImportCardSchema>;
