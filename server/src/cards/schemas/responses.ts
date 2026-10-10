import { z } from 'zod';

import { CardPurchaseSchema, CardCoreFieldsSchema, CardIdSchema } from './fields.ts';
import { OwnedCardPriceSchema } from '../../card-pricing/schemas/responses.ts';
import { ApiCommonDatetime } from '../../schemas/common.ts';

export const CardSchema = CardCoreFieldsSchema.extend({
  id: CardIdSchema.meta({
    description: 'Unique card entry identifier',
    example: '550e8400-e29b-41d4-a716-446655440000',
  }),
  notes: z.string().max(2000).nullable().meta({ description: 'Optional notes', example: 'Alternate art' }),
  purchases: z.array(CardPurchaseSchema),
  purchase_price_change_percent: z.number().nullable(),
  created_at: ApiCommonDatetime.meta({
    description: 'Creation timestamp',
    example: '2026-07-20T10:30:00.000Z',
  }),
  updated_at: ApiCommonDatetime.meta({
    description: 'Last update timestamp',
    example: '2026-07-20T10:30:00.000Z',
  }),
}).meta({
  $id: 'Card',
  title: 'Card',
  description: 'An owned trading card entry',
  example: {
    id: '550e8400-e29b-41d4-a716-446655440000',
    game: 'one_piece',
    name: 'Monkey D. Luffy',
    set_name: 'Romance Dawn',
    card_number: 'OP01-003',
    notes: null,
    purchases: [
      {
        id: '550e8400-e29b-41d4-a716-446655440001',
        condition: 'near_mint',
        quantity: 2,
        purchase_price: null,
        currency: null,
        automatic_price_date: null,
      },
    ],
    purchase_price_change_percent: null,
    created_at: '2026-07-20T10:30:00.000Z',
    updated_at: '2026-07-20T10:30:00.000Z',
  },
});

/**
 * An owned card together with its price.
 *
 * Written as an intersection rather than an extension so the document composes it from the `Card`
 * component instead of repeating every field.
 */
export const CardWithPriceSchema = z.intersection(CardSchema, z.object({ price: OwnedCardPriceSchema })).meta({
  $id: 'CardWithPrice',
  title: 'Card With Price',
  description: 'An owned trading card entry with its freshly refreshed price',
  example: {
    id: '550e8400-e29b-41d4-a716-446655440000',
    game: 'one_piece',
    name: 'Monkey D. Luffy',
    set_name: 'Romance Dawn',
    card_number: 'OP01-003',
    notes: null,
    purchases: [
      {
        id: '550e8400-e29b-41d4-a716-446655440001',
        condition: 'near_mint',
        quantity: 2,
        purchase_price: null,
        currency: null,
        automatic_price_date: null,
      },
    ],
    purchase_price_change_percent: null,
    created_at: '2026-07-20T10:30:00.000Z',
    updated_at: '2026-07-20T10:30:00.000Z',
    price: { card_id: '550e8400-e29b-41d4-a716-446655440000', status: 'priced' },
  },
});

export const CardsListResponseSchema = z
  .object({
    cards: z.array(CardWithPriceSchema).meta({ description: 'Owned card entries with daily pricing, newest first' }),
    available_set_names: z.array(CardCoreFieldsSchema.shape.set_name).meta({
      description: 'Distinct owned set names in alphabetical order, scoped by game but independent of the set filter',
    }),
  })
  .meta({
    $id: 'CardsListResponse',
    title: 'Cards List Response',
    description: "The authenticated user's card collection",
    example: { cards: [], available_set_names: [] },
  });

export type CardResponse = z.infer<typeof CardSchema>;

export type CardWithPriceResponse = z.infer<typeof CardWithPriceSchema>;

export type CardsListResponse = z.infer<typeof CardsListResponseSchema>;

export const DeleteCardsResponseSchema = z
  .object({
    deleted_ids: z.array(CardIdSchema),
    not_found_ids: z.array(CardIdSchema),
  })
  .meta({ $id: 'DeleteCardsResponse', title: 'Delete Cards Response' });

export type DeleteCardsResponse = z.infer<typeof DeleteCardsResponseSchema>;
