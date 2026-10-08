import { z } from 'zod';

import { CurrencySchema } from '../../card-pricing/schemas/responses.ts';
import { CARD_CONDITIONS, CARD_GAMES, MAX_COPIES_PER_CONDITION } from '../../db/schema/cards.ts';

export const CardIdSchema = z.uuid();

export const CardCoreFieldsSchema = z.object({
  game: z.enum(CARD_GAMES).meta({ description: 'Trading card game', example: 'one_piece' }),
  name: z.string().min(1).max(200).meta({ description: 'Card name', example: 'Monkey D. Luffy' }),
  set_name: z.string().min(1).max(200).meta({ description: 'Set name', example: 'Romance Dawn' }),
  card_number: z.string().min(1).max(50).meta({ description: 'Card number', example: 'OP01-003' }),
});

export const CardConditionQuantitySchema = z
  .object({
    condition: z.enum(CARD_CONDITIONS).meta({ description: 'Condition of the owned copies', example: 'near_mint' }),
    quantity: z
      .number()
      .int()
      .min(1)
      .max(MAX_COPIES_PER_CONDITION)
      .meta({ description: 'Number of copies owned in this condition', example: 2 }),
  })
  .meta({
    $id: 'CardConditionQuantity',
    title: 'Card Condition Quantity',
    description: 'Quantity owned for one card condition',
    example: { condition: 'near_mint', quantity: 2 },
  });

export const PurchaseAmountSchema = z
  .string()
  .regex(/^(?:0|[1-9]\d{0,13})(?:\.\d{1,6})?$/)
  .meta({
    description: 'Nonnegative price per card, as an exact decimal with at most six fractional digits',
    example: '2.50',
  });

const CardPurchaseFieldsSchema = z.object({
  id: CardIdSchema.optional(),
  condition: CardConditionQuantitySchema.shape.condition,
  quantity: CardConditionQuantitySchema.shape.quantity,
  purchase_price: PurchaseAmountSchema.nullable(),
  // Swift OpenAPI Generator needs nullable enums inline rather than a reference/null union.
  currency: CurrencySchema.meta({ $id: undefined }).nullable(),
});

export const CardPurchaseInputSchema = CardPurchaseFieldsSchema.refine(
  batch => (batch.purchase_price == null) === (batch.currency == null),
  {
    message: 'Purchase price and currency must be provided together',
    path: ['purchase_price'],
  },
).meta({ $id: 'CardPurchaseInput', title: 'Card Purchase Input' });

export const CardPurchaseSchema = CardPurchaseFieldsSchema.extend({
  id: CardIdSchema,
  automatic_price_date: z.string().nullable().meta({
    description: 'Market pricing day used to automatically fill the purchase price',
  }),
}).meta({ $id: 'CardPurchase', title: 'Card Purchase' });
